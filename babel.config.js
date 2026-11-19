/**
 * Babel config for the webOS 22+ bundle: Chrome 87, types stripped, nothing
 * else. Every file is parsed as a module, and babel-loader tells preset-env
 * that webpack takes the ES modules as they are.
 */

/** @type {import('@babel/core').TransformOptions} */
export default {
  presets: [
    [
      '@babel/preset-env',
      {
        // BROWSERSLIST from webpack.config.js; the same engine by name otherwise.
        targets: process.env.BROWSERSLIST || 'chrome 87'
      }
    ]
  ],
  // Strips the types; tsc checks them separately.
  plugins: ['@babel/plugin-transform-typescript']
};
