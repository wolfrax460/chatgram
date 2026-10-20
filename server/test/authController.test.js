// Test file to verify auth controller functions
const authController = require('./src/controllers/authController');

console.log('Testing auth controller imports...');

describe('Auth Controller Functions', () => {
  test('registerUser should exist', () => {
    expect(authController.registerUser).toBeDefined();
    expect(typeof authController.registerUser).toBe('function');
  });

  test('loginUser should exist', () => {
    expect(authController.loginUser).toBeDefined();
    expect(typeof authController.loginUser).toBe('function');
  });

  test('refreshToken should exist', () => {
    expect(authController.refreshToken).toBeDefined();
    expect(typeof authController.refreshToken).toBe('function');
  });

  test('getUserProfile should exist', () => {
    expect(authController.getUserProfile).toBeDefined();
    expect(typeof authController.getUserProfile).toBe('function');
  });

  test('logoutUser should exist', () => {
    expect(authController.logoutUser).toBeDefined();
    expect(typeof authController.logoutUser).toBe('function');
  });
});

console.log('Auth controller imported successfully');