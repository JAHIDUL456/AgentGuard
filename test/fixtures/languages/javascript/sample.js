const http = require('http');
import lodash from 'lodash';

class ServerManager {
  start() {
    return true;
  }
}

function createHandler() {
  return (req, res) => res.end();
}

module.exports = { ServerManager, createHandler };
