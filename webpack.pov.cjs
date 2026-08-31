const path = require('node:path')
const webpack = require('webpack')

module.exports = {
  mode: 'production',
  entry: './viewer-client/index.cjs',
  output: { path: path.resolve(__dirname, 'public/pov-viewer'), filename: 'index.js' },
  performance: { hints: false },
  resolve: {
    alias: {
      canvas: path.resolve(__dirname, 'viewer-client/canvas-shim.cjs'),
      [require.resolve('prismarine-viewer/viewer/lib/utils.js')]: require.resolve('prismarine-viewer/viewer/lib/utils.web.js'),
      [require.resolve('prismarine-viewer/viewer/lib/utils.electron.js')]: require.resolve('prismarine-viewer/viewer/lib/utils.web.js')
    },
    fallback: { fs: false, path: false, zlib: false }
  },
  plugins: [
    new webpack.ProvidePlugin({ process: 'process/browser', Buffer: ['buffer', 'Buffer'] }),
    new webpack.DefinePlugin({ 'process.platform': JSON.stringify('browser') })
  ]
}
