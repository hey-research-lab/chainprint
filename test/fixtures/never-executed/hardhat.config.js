// If anything ever ran this file, it would leave a marker file behind.
require('node:fs').writeFileSync(require('node:path').join(__dirname, 'EXECUTED'), 'ran');
module.exports = { networks: { robinhood: { chainId: 4663 } } };
