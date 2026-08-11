const nodeCrypto = require('crypto');

if (typeof nodeCrypto.getRandomValues !== 'function') {
  nodeCrypto.getRandomValues = function getRandomValues(typedArray) {
    return nodeCrypto.randomFillSync(typedArray);
  };
}
