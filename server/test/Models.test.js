// Test file to verify model structures
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Chat = require('./src/models/Chat');
const Message = require('./src/models/Message');
const Status = require('./src/models/Status');

console.log('Testing model imports...');

describe('Model Definitions', () => {
  test('User model should exist', () => {
    expect(User).toBeDefined();
  });

  test('Chat model should exist', () => {
    expect(Chat).toBeDefined();
  });

  test('Message model should exist', () => {
    expect(Message).toBeDefined();
  });

  test('Status model should exist', () => {
    expect(Status).toBeDefined();
  });
});

console.log('Models imported successfully');