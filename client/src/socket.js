import { io } from 'socket.io-client';
import { emitter } from './emitter';

const socket = io('http://localhost:3001');

socket.on('newParkingSpot', (data) => emitter.emit('newParkingSpot', data));
socket.on('spotDeleted', (data) => emitter.emit('spotDeleted', data));
socket.on('spotRequest', (data) => emitter.emit('spotRequest', data));
socket.on('requestResponse', (data) => emitter.emit('requestResponse', data));
socket.on('spotUpdated', (data) => emitter.emit('spotUpdated', data));
socket.on('etaUpdate', (data) => emitter.emit('etaUpdate', data));
socket.on('requesterArrived', (data) => emitter.emit('requesterArrived', data));
socket.on('transactionComplete', (data) => emitter.emit('transactionComplete', data));

export const emitAcceptRequest = (data) => socket.emit('acceptRequest', data);
export const emitDeclineRequest = (data) => socket.emit('declineRequest', data);
export const emitAcknowledgeArrival = (data) => socket.emit('acknowledgeArrival', data);
export const emitRegister = (data) => socket.emit('register', data);
export const emitUnregister = (data) => socket.emit('unregister', data);

export { socket };
