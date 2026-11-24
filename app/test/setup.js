// Vega-only modules have no Jest implementation: stub what the app uses.
jest.mock('@amazon-devices/react-native-kepler', () => ({
  useTVEventHandler: jest.fn(),
}));
jest.mock('../src/storage', () => ({
  AsyncStorage: {getItem: jest.fn(() => Promise.resolve(null)), setItem: jest.fn(() => Promise.resolve())},
}));
jest.mock('@amazon-devices/kepler-identifiers', () => ({
  KeplerIdentifiers: {
    getFriendlyDeviceName: jest.fn(() => Promise.resolve('Fire TV Stick 4K Select')),
    addFriendlyDeviceNameListener: jest.fn(() => Promise.resolve({unsubscribe: jest.fn()})),
  },
}));
jest.mock('@amazon-devices/security-manager-lib', () => ({
  PrivilegeState: {ALLOW: 'ALLOW', DENY: 'DENY'},
  SecurityManager: {
    getPrivilegeState: jest.fn(() => Promise.resolve('DENY')),
    requestPrivilege: jest.fn(() => Promise.resolve('DENY')),
  },
}));
jest.mock('@amazon-devices/react-native-device-info', () => ({getModel: jest.fn(() => 'Fire TV Stick 4K Select')}));
// The Vega WebView: a View that records its props and injected scripts, so
// tests can play the receiver page (onMessage) and see what the app told it.
jest.mock('@amazon-devices/webview', () => {
  const React = require('react');
  const {View} = require('react-native');
  const WebView = React.forwardRef((props, ref) => {
    globalThis.__webView = props;
    React.useImperativeHandle(ref, () => ({
      injectJavaScript: (js) => (globalThis.__injected = [...(globalThis.__injected || []), js]),
    }));
    return React.createElement(View, {testID: 'webview'});
  });
  return {WebView};
});
