module.exports = {
  dependency: {
    platforms: {
      kepler: {
        autolink: {
          CastAir: {
            libraryName: 'libCastAir.so',
            linkDynamic: true,
            provider: 'application',
            components: [],
            turbomodules: ['CastAir'],
          },
        },
      },
    },
  },
};
