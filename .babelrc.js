module.exports = {
  presets: [
    '@babel/preset-flow',
    [
      '@babel/preset-env',
      {
        targets: {
          node: '8.7',
        },
        modules: 'commonjs',
        useBuiltIns: 'entry',
        loose: true,
        debug: false,
      },
    ],
    [
      '@babel/preset-stage-1',
      {
        loose: true,
        useBuiltIns: true,
      },
    ],
  ],
};
