import CopyPlugin from 'copy-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';
import webpack from 'webpack';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const requireCjs = createRequire(import.meta.url);
const { AssertNoBareRequirePlugin } = requireCjs('./tools/assert-no-bare-require.cjs');
const { version } = requireCjs('./package.json');

/**
 * The test build number: `--env build=N`, else the YTAF_BUILD environment
 * variable (the test-build workflow sets it from the commit title), else none
 * (a release). A number or nothing; anything else stops the build.
 */
function testBuildNumber(env) {
  const raw = String((env && env.build) || process.env.YTAF_BUILD || '').trim();
  if (raw && !/^\d+$/.test(raw)) {
    throw new Error(`The test build number must be a whole number, got "${raw}"`);
  }
  return raw;
}

/** @type {(env: Record<string, string>) => (import('webpack').Configuration)[]} */
const makeConfig = (env) => {
  // Dev-only instrumentation; see src/dev/perf-mon.js. Off unless `--env perf`.
  const withPerfMon = !!(env && env.perf);
  const build = testBuildNumber(env);
  // What the panel heading shows (src/core/version.js): 0.8.5, 0.8.5 b2.
  const versionLabel = version + (build ? ` b${build}` : '');
  // webOS 22's engine, as a browserslist query. Every tool that asks
  // browserslist (autoprefixer, cssnano, Babel's preset-env) reads it from the
  // environment, so the CSS and the JS aim at the same browser.
  const browsers = 'chrome 87';
  process.env.BROWSERSLIST = browsers;

  return [
    {
      target: `browserslist:${browsers}`,
      // No eval-wrapped modules in build:dev either: the TV runs the bundle as is.
      devtool: false,
      // A fresh dist/ per build so nothing stale reaches the package.
      output: { clean: true },
      entry: {
        index: './src/index.js',
        userScript: {
          import: './src/userScript.js',
          filename: 'webOSUserScripts/[name].js'
        }
      },
      resolve: {
        // perf-mon only in a `--env perf` build.
        alias: withPerfMon ? {} : { [path.resolve(__dirname, 'src/dev/perf-mon.js')]: false }
      },
      module: {
        rules: [
          {
            test: /\.[jt]s$/i,
            loader: 'babel-loader',
            // node_modules ships code Chrome 87 runs as is.
            exclude: /node_modules/,
            options: { cacheDirectory: true }
          },
          {
            test: /\.png$/i,
            type: 'asset/inline'
          },
          {
            test: /\.css$/i,
            use: [
              // Every stylesheet handed to src/core/styles.js, which puts them
              // in the page as one <style>, written once.
              path.resolve(__dirname, 'tools/css-collect-loader.cjs'),
              {
                loader: 'postcss-loader',
                options: {
                  postcssOptions: {
                    plugins: [
                      // The engine's prefixes, so the sources carry none.
                      'autoprefixer',
                      [
                        'cssnano',
                        {
                          preset: [
                            'default',
                            {
                              discardComments: { removeAll: true }
                            }
                          ]
                        }
                      ]
                    ]
                  }
                }
              }
            ]
          }
        ]
      },
      optimization: {
        // Everything else Terser does here is its production default.
        minimizer: [
          new TerserPlugin({
            terserOptions: {
              // The perf build keeps function names, so perf-mon's registry
              // can name what runs; the release builds are unaffected.
              keep_fnames: withPerfMon,
              keep_classnames: withPerfMon,
              format: {
                comments: false,
                ascii_only: true
              },
              compress: {
                // Passes past two shrink the bundles by some 50 bytes and
                // lengthen the build.
                passes: 2,
                // A helper with one caller stays a declared function: inlined,
                // it became a function expression created on every call of
                // its caller, a closure per item on the filter and walk paths,
                // which Chromium 38's compiler does not optimise away.
                reduce_funcs: false,
                ecma: 2020
              }
            },
            extractComments: false
          })
        ]
      },
      // Not the default: production mode warns past 244 KiB, advice for pages
      // loaded over a network. The app is installed on the TV and read from
      // its storage; tests/smoke/bundle-check.cjs holds each bundle to a budget.
      performance: {
        hints: false
      },
      plugins: [
        // Catches the "ReferenceError: require is not defined" failure mode at
        // build time instead of on the TV. See the plugin for the full story.
        new AssertNoBareRequirePlugin(),
        new webpack.DefinePlugin({
          __YTAF_VERSION__: JSON.stringify(versionLabel)
        }),
        new CopyPlugin({
          patterns: [
            // icon.svg is the source the PNG icons are drawn from; the TV
            // reads only the PNGs appinfo.json names, so it stays out of the package.
            { context: 'assets', from: '**/*', globOptions: { ignore: ['**/icon.svg'] } },
            { context: 'src', from: 'index.html' }
          ]
        })
      ]
    }
  ];
};

export default makeConfig;
