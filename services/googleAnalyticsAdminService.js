/**
 * Reason: Google Analytics 4 Admin API service layer handling account/property discovery, metadata enrichment,
 * MongoDB property persistence/synchronization, and property selection state management.
 * How: Reuses low-level OAuth token refresh from googleSearchConsoleService, queries Google Analytics Admin API v1beta,
 * normalizes property payloads, and enforces strict tenant/user property authorization.
 */

const GoogleIntegration = require('../models/GoogleIntegration');
const GoogleAnalyticsProperty = require('../models/GoogleAnalyticsProperty');
const googleService = require('./googleSearchConsoleService');

const ADMIN_API_BASE_URL = 'https://analyticsadmin.googleapis.com/v1beta';

/**
 * Checks whether the granted scopes include GA4 read-only access
 */
const hasAnalyticsScope = (grantedScopes = []) => {
  if (!Array.isArray(grantedScopes)) return false;
  return (
    grantedScopes.includes('https://www.googleapis.com/auth/analytics.readonly') ||
    grantedScopes.includes('https://www.googleapis.com/auth/analytics')
  );
};

/**
 * Base Google Analytics Admin API request wrapper with centralized error handling
 */
const fetchAnalyticsAdminApi = async (url, accessToken, options = {}) => {
  const reqHeaders = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(url, {
      ...options,
      headers: reqHeaders,
    });
  } catch (networkErr) {
    const err = new Error(`Google Analytics Admin API network error: ${networkErr.message}`);
    err.statusCode = 502;
    throw err;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    const errorObj = data.error || {};
    const code = errorObj.code || response.status;
    const message = errorObj.message || 'Google Analytics Admin API request failed';

    if (code === 401) {
      const err = new Error('Google access token is invalid or has expired');
      err.statusCode = 401;
      err.googleError = errorObj;
      throw err;
    }

    if (code === 403) {
      const err = new Error(`Google Analytics permission error: ${message}`);
      err.statusCode = 403;
      err.googleError = errorObj;
      throw err;
    }

    const err = new Error(`Google Analytics Admin API error (${code}): ${message}`);
    err.statusCode = response.status >= 400 && response.status < 600 ? response.status : 500;
    err.googleError = errorObj;
    throw err;
  }

  return data;
};

/**
 * Lists all AccountSummaries accessible to the authenticated user (handles pagination if present)
 */
const listAccountSummaries = async (accessToken) => {
  let allSummaries = [];
  let nextPageToken = null;

  do {
    const url = new URL(`${ADMIN_API_BASE_URL}/accountSummaries`);
    url.searchParams.set('pageSize', '200');
    if (nextPageToken) {
      url.searchParams.set('pageToken', nextPageToken);
    }

    const data = await fetchAnalyticsAdminApi(url.toString(), accessToken, { method: 'GET' });
    const summaries = Array.isArray(data.accountSummaries) ? data.accountSummaries : [];
    allSummaries = allSummaries.concat(summaries);
    nextPageToken = data.nextPageToken || null;
  } while (nextPageToken);

  return allSummaries;
};

/**
 * Fetches metadata details for a specific GA4 property (e.g. timeZone, currencyCode)
 */
const getPropertyMetadata = async (accessToken, propertyResourceName) => {
  try {
    const url = `${ADMIN_API_BASE_URL}/${propertyResourceName}`;
    const data = await fetchAnalyticsAdminApi(url, accessToken, { method: 'GET' });
    return {
      timeZone: data.timeZone || 'UTC',
      currencyCode: data.currencyCode || 'USD',
    };
  } catch (err) {
    // Non-fatal fallback if property metadata detail endpoint fails
    return {
      timeZone: 'UTC',
      currencyCode: 'USD',
    };
  }
};

/**
 * Evaluates Google Analytics capability status for the user
 */
const evaluateCapabilities = (integration, properties = []) => {
  const isConnected = Boolean(integration && integration.status === 'connected' && integration.accessToken);

  if (!isConnected) {
    return {
      available: false,
      code: 'NOT_CONNECTED',
      reason: 'Google account is not connected or authorization has expired',
    };
  }

  if (!hasAnalyticsScope(integration.grantedScopes)) {
    return {
      available: false,
      code: 'SCOPE_MISSING',
      reason: 'Google Analytics read-only permission (analytics.readonly) is missing. Please reconnect your Google account.',
    };
  }

  if (properties.length === 0) {
    return {
      available: false,
      code: 'ASSET_NOT_FOUND',
      reason: 'No accessible Google Analytics 4 properties discovered for this account',
    };
  }

  return {
    available: true,
    code: 'AVAILABLE',
    reason: null,
  };
};

/**
 * Discovers accessible GA4 properties via Google Analytics Admin API,
 * synchronizes them into MongoDB (upsert), preserves selection state, and soft-inactivates stale properties.
 */
const discoverAndSyncProperties = async (userId) => {
  const integration = await GoogleIntegration.findOne({ userId });

  if (!integration || integration.status !== 'connected') {
    const capabilities = evaluateCapabilities(integration, []);
    return {
      properties: [],
      selectedProperty: null,
      count: 0,
      capabilities,
    };
  }

  if (!hasAnalyticsScope(integration.grantedScopes)) {
    const existingProperties = await GoogleAnalyticsProperty.find({ userId, isActive: true });
    const selectedProperty = existingProperties.find((p) => p.isSelected) || null;
    const capabilities = evaluateCapabilities(integration, existingProperties);
    return {
      properties: existingProperties,
      selectedProperty,
      count: existingProperties.length,
      capabilities,
    };
  }

  // Retrieve valid access token (using existing Search Console token refresh mechanism)
  const accessToken = await googleService.getValidAccessToken(userId);

  // 1. Query Google Analytics Admin API
  const accountSummaries = await listAccountSummaries(accessToken);

  // 2. Extract and normalize discovered properties
  const discoveredItems = [];
  for (const accSummary of accountSummaries) {
    const rawAccId = accSummary.account || '';
    const googleAccountId = rawAccId.replace('accounts/', '');
    const googleAccountName = accSummary.displayName || rawAccId;

    const propSummaries = Array.isArray(accSummary.propertySummaries) ? accSummary.propertySummaries : [];

    for (const propSummary of propSummaries) {
      const rawPropName = propSummary.property || '';
      const propertyId = rawPropName.replace('properties/', '').trim();
      const displayName = propSummary.displayName || rawPropName;
      const propertyType = propSummary.propertyType || 'PROPERTY_TYPE_ORDINARY';

      if (propertyId) {
        discoveredItems.push({
          googleAccountId,
          googleAccountName,
          propertyId,
          propertyName: `properties/${propertyId}`,
          displayName,
          propertyType,
        });
      }
    }
  }

  const discoveredPropertyIds = discoveredItems.map((item) => item.propertyId);

  // 3. Upsert discovered properties into MongoDB
  for (const item of discoveredItems) {
    // Check if property metadata needs timezone/currency enrichment
    const existing = await GoogleAnalyticsProperty.findOne({ userId, propertyId: item.propertyId });
    let timeZone = existing ? existing.timeZone : 'UTC';
    let currencyCode = existing ? existing.currencyCode : 'USD';

    // Enrich timezone/currency for new properties or default values
    if (!existing || existing.timeZone === 'UTC') {
      const metadata = await getPropertyMetadata(accessToken, item.propertyName);
      timeZone = metadata.timeZone;
      currencyCode = metadata.currencyCode;
    }

    await GoogleAnalyticsProperty.findOneAndUpdate(
      { userId, propertyId: item.propertyId },
      {
        googleAccountId: item.googleAccountId,
        googleAccountName: item.googleAccountName,
        propertyName: item.propertyName,
        displayName: item.displayName,
        propertyType: item.propertyType,
        timeZone,
        currencyCode,
        isActive: true,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  // 4. Soft-inactivate properties no longer returned by Google
  if (discoveredPropertyIds.length > 0) {
    await GoogleAnalyticsProperty.updateMany(
      { userId, propertyId: { $nin: discoveredPropertyIds } },
      { isActive: false }
    );
  } else {
    await GoogleAnalyticsProperty.updateMany({ userId }, { isActive: false });
  }

  // 5. Fetch updated active properties for the user
  const activeProperties = await GoogleAnalyticsProperty.find({ userId, isActive: true }).sort({ displayName: 1 });

  // 6. Preserve & enforce single selected property rule
  let selectedProperty = activeProperties.find((p) => p.isSelected) || null;

  if (!selectedProperty && activeProperties.length > 0) {
    // If no property is currently selected, default the first property to selected
    activeProperties[0].isSelected = true;
    await activeProperties[0].save();
    selectedProperty = activeProperties[0];
  }

  const capabilities = evaluateCapabilities(integration, activeProperties);

  return {
    properties: activeProperties,
    selectedProperty,
    count: activeProperties.length,
    capabilities,
  };
};

/**
 * Selects a specific GA4 property for the authenticated user after verifying ownership
 */
const setSelectedProperty = async (userId, targetPropertyIdInput) => {
  if (!targetPropertyIdInput || !String(targetPropertyIdInput).trim()) {
    const err = new Error('Missing required field: propertyId is required');
    err.statusCode = 400;
    throw err;
  }

  // Clean numeric property ID format (e.g., convert "properties/123456789" -> "123456789")
  const propertyId = String(targetPropertyIdInput).replace('properties/', '').trim();

  // Verify that the requested property belongs to the user and is active
  const targetProperty = await GoogleAnalyticsProperty.findOne({ userId, propertyId, isActive: true });

  if (!targetProperty) {
    const err = new Error(
      `Access denied: Google Analytics 4 property '${propertyId}' is not accessible by this account`
    );
    err.statusCode = 403;
    throw err;
  }

  // Set all properties for this user to isSelected = false
  await GoogleAnalyticsProperty.updateMany({ userId }, { isSelected: false });

  // Mark the target property as selected
  targetProperty.isSelected = true;
  await targetProperty.save();

  return targetProperty;
};

/**
 * Retrieves the currently selected active GA4 property for a user
 */
const getSelectedProperty = async (userId) => {
  const selectedProperty = await GoogleAnalyticsProperty.findOne({ userId, isSelected: true, isActive: true });
  return selectedProperty || null;
};

module.exports = {
  hasAnalyticsScope,
  listAccountSummaries,
  getPropertyMetadata,
  evaluateCapabilities,
  discoverAndSyncProperties,
  setSelectedProperty,
  getSelectedProperty,
};
