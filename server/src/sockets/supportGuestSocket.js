/**
 * `/support-guest` Socket.IO namespace.
 *
 * Anonymous visitors of the help widget connect here with a short-lived signed
 * token issued when they file a ticket. They can only ever receive events for
 * that one ticket — there is no way to join another room.
 *
 * Completely separate from the main namespace, so the authenticated chat
 * sockets are untouched.
 */
const { verifyGuestToken } = require('../support/guestToken');

const NAMESPACE = '/support-guest';

function roomForTicket(ticketId) {
  return `ticket:${ticketId}`;
}

/**
 * Emit an event to a ticket's guests. Safe to call even if nobody is listening.
 * @param {import('socket.io').Server} io
 */
function emitToTicket(io, ticketId, event, payload) {
  if (!io || !ticketId) return;
  try {
    io.of(NAMESPACE).to(roomForTicket(String(ticketId))).emit(event, payload);
  } catch (error) {
    console.warn('emitToTicket failed:', error.message);
  }
}

function registerSupportGuestNamespace(io) {
  const guest = io.of(NAMESPACE);

  // Token comes from handshake.auth.token (preferred) or ?token=.
  guest.use((socket, next) => {
    const token =
      socket.handshake.auth?.token || socket.handshake.query?.token || '';
    const result = verifyGuestToken(token);
    if (!result.ok) {
      return next(new Error(result.reason || 'unauthorized'));
    }
    socket.data.ticketId = result.ticketId;
    socket.data.guestId = result.guestId;
    return next();
  });

  guest.on('connection', (socket) => {
    const ticketId = socket.data.ticketId;
    socket.join(roomForTicket(ticketId));
    socket.emit('guest:ready', { ticketId });

    socket.on('ticket:join', (data = {}) => {
      // Only the ticket the token was issued for.
      if (String(data.ticketId || '') !== String(ticketId)) return;
      socket.join(roomForTicket(ticketId));
    });

    socket.on('disconnect', () => {
      /* socket.io cleans up room membership */
    });
  });

  console.log(`Support guest namespace ready at ${NAMESPACE}`);
  return guest;
}

module.exports = { registerSupportGuestNamespace, emitToTicket, roomForTicket, NAMESPACE };
