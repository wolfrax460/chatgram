/** Remove any leftover production smoke-test accounts and their data. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Chat = require('./src/models/Chat');
const Message = require('./src/models/Message');
const Status = require('./src/models/Status');
const Report = require('./src/models/Report');

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const users = await User.find({ email: /^deploy-test-[ab]-.*@chatgram\.test$/ }).select('_id displayName email');
  console.log('test accounts found:', users.length);
  const ids = users.map((user) => user._id);
  if (ids.length) {
    await Message.deleteMany({ senderId: { $in: ids } });
    const chats = await Chat.find({ participants: { $in: ids } }).select('_id');
    await Message.deleteMany({ chatId: { $in: chats.map((chat) => chat._id) } });
    await Chat.deleteMany({ _id: { $in: chats.map((chat) => chat._id) } });
    await Status.deleteMany({ userId: { $in: ids } });
    await Report.deleteMany({ $or: [{ reporterId: { $in: ids } }, { targetUserId: { $in: ids } }] });
    await User.deleteMany({ _id: { $in: ids } });
  }
  const left = await User.countDocuments({ email: /^deploy-test-[ab]-.*@chatgram\.test$/ });
  const statuses = await Status.countDocuments({});
  console.log('remaining test accounts:', left, '| total statuses:', statuses);
  await mongoose.disconnect();
})().catch((error) => {
  console.error('CLEANUP_FAILED', error.message);
  process.exit(1);
});
