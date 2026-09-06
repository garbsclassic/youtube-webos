import CopyPlugin from 'copy-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';

/** @type {() => (import('webpack').Configuration)[]} */
const makeConfig = () => [
  {
    // Plain 'browserslist' reads .browserslistrc, which is now the single
    // source of truth for both this and preset-env below.
    target: 'browserslist',
    devtool: false,
    entry: {
      index: './src/index.js',
      userScript: {
        import: './src/userScript.js',
        filename: 'webOSUserScripts/[name].js'
      }
    },
    resolve: {
      extensions: ['.mjs', '.cjs', '.js', '.json', '.ts']
    },
    module: {
      rules: [
        {
          test: /\.[mc]?[jt]s$/i,
          loader: 'babel-loader',
          exclude: /node_modules/,
          options: {
            cacheDirectory: true,
            babelrc: false,
            configFile: false,
            presets: [
              [
                '@babel/preset-env',
                {
                  // targets omitted on purpose: preset-env falls back to
                  // .browserslistrc, so the support floor lives in one file.
                  bugfixes: true,
                  modules: false,
                  useBuiltIns: false
                }
              ]
            ],
            plugins: [['@babel/plugin-transform-typescript', { strictMode: true }]]
          },
          resolve: {
            fullySpecified: false
          }
        },
        {
          test: /\.(png|jpe?g|svg|woff2?)$/i,
          type: 'asset/inline'
        },
        {
          test: /\.css$/i,
          use: [
            { loader: 'style-loader' },
            {
              loader: 'css-loader',
              options: {
                esModule: false,
                importLoaders: 1,
                modules: false
              }
            },
            {
              loader: 'postcss-loader',
              options: {
                postcssOptions: {
                  plugins: [
                    [
                      'cssnano',
                      {
                        preset: [
                          'default',
                          {
                            discardComments: { removeAll: true },
                            normalizeWhitespace: true,
                            colormin: true,
                            minifySelectors: true,
                            minifyFontValues: true
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
      minimize: true,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            format: {
              comments: false,
              ascii_only: true
            },
            compress: {
              drop_console: false,
              drop_debugger: true,
              passes: 4,
              arrows: true,
              ecma: 2020
            },
            mangle: true
          },
          extractComments: false
        })
      ]
    },
    performance: {
      hints: false
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { context: 'assets', from: '**/*' },
          { context: 'src', from: 'index.html' }
        ]
      })
    ]
  }
];

export default makeConfig;
