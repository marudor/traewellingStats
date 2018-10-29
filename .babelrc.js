module.exports = {
  presets: [
    '@babel/preset-flow',
    [
      '@babel/preset-env',
      {
        targets: {
          node: '10.12',
        },
        modules: 'commonjs',
        useBuiltIns: 'entry',
        loose: true,
        debug: false,
      },
    ],
    'babel-preset-joblift',
  ],
};
