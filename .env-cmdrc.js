import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const defaultConfig = require('./config/default.json');
const devConfig = require('./config/dev.json');
const prodConfig = require('./config/prod.json');

export default {
  default: defaultConfig,
  dev: devConfig,
  prod: prodConfig,
};
