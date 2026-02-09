// Backward compatibility: Re-export from refactored users directory
// This file maintains backward compatibility for existing imports
// All functionality has been moved to backend/src/services/users/

module.exports = require('./users/index');
