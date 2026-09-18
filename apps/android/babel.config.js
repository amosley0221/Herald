module.exports = (api) => {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    plugins: [
      // Must be last. Reanimated's worklets plugin rewrites function bodies and
      // has to see the final AST.
      'react-native-worklets/plugin',
    ],
  };
};
