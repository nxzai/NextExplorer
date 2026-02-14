export function createErrorHandler(notificationsStore, i18n) {
  return (errorInfo) => {
    const { code, message, requestId, statusCode, details } = errorInfo;

    let heading = message || 'An error occurred';

    // Translate if we have a code
    if (code) {
      const key = `serverErrors.${code}`;
      const translated = i18n.global.t(key);

      if (translated !== key) {
        // Handle rate limit pluralization
        if (code.startsWith('RATE_LIMIT_') && details?.retryAfter) {
          const minutes = Math.ceil(details.retryAfter / 60);
          heading = i18n.global.t(key, { minutes }, minutes);
        } else {
          heading = translated;
        }
      }
    }

    notificationsStore.addNotification({
      type: 'error',
      heading,
      body: details ? JSON.stringify(details) : '',
      requestId,
      statusCode,
    });

    // Return translated message for error thrown by http.js
    return heading;
  };
}
