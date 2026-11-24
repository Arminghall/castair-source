// A native UI component (not a turbomodule): the runtime loads
// com.arminghall.castair.surface.so and asks its IViewManagerFactory for the
// "CastAirSurface" view manager.
module.exports = {
  dependency: {
    platforms: {
      kepler: {
        autolink: {
          CastAirSurface: {
            uiComponentName: '/com.arminghall.castair.surface',
            linkDynamic: true,
            provider: 'application',
            components: ['CastAirSurface'],
            turbomodules: [],
          },
        },
      },
    },
  },
};
