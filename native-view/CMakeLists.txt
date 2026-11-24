cmake_minimum_required(VERSION 3.22)

project(CastAirSurface
        VERSION 0.1
        LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)

# A native UI component, built the SDK's way (.claude/docs/DECISIONS.md D10): the IDL
# import library generates the interface glue for the OS's libapmf.so. No
# vendor static library is linked.
find_package(Apmf REQUIRED)
find_package(Kepler REQUIRED)

kepler_add_idl_import_library(castair_surface_idl
  PACKAGES
  com.amazon.kepler.audio
  com.amazon.kepler.buffer
  com.amazon.kepler.buffer_queue
  com.amazon.kepler.graphics
  com.amazon.kepler.media_descriptor
  com.amazon.kepler.media_transform
  com.amazon.kepler.uitoolkit.graphics
  com.amazon.kepler.uitoolkit.view
  com.amazon.kepler.uitoolkit.react
)

# The runtime loads the component by its name: /com.arminghall.castair.surface
# → com.arminghall.castair.surface.so (react-native.config.js uiComponentName).
kepler_add_library(CastAirSurface SHARED
  src/CastAirSurface.cpp
  src/AudioOut.cpp
  src/Decoder.cpp
)
set_target_properties(CastAirSurface PROPERTIES
  PREFIX ""
  OUTPUT_NAME com.arminghall.castair.surface)
# The bridge header is shared with the receiver (native/include).
target_include_directories(CastAirSurface PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../native/include)
target_link_libraries(CastAirSurface PRIVATE castair_surface_idl pthread dl)

kepler_install_components(CastAirSurface IN_PROCESS "/com.arminghall.castair.surface")
