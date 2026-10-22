import { createRoot } from 'react-dom/client';
import { Root, type Streams } from './Root.tsx';
import { httpApi, mockApi, type Api } from './net/api.ts';
import { connectWebSocket } from './net/transport.ts';
import { streamPathFor } from './route.ts';
import './styles.css';
import './rooms.css';

let api: Api = httpApi;
let streams: Streams = (route) => connectWebSocket(streamPathFor(route));
const isMock = new URLSearchParams(location.search).has('mock');
if (isMock) {
  const { mockOptionsFromUrl, mockServer } = await import('./dev/mockServer.ts');
  const { mockRooms } = await import('./dev/mockRooms.ts');
  const options = mockOptionsFromUrl(location.search)!;
  const rooms = mockRooms({ empty: options.empty });
  const serverFor: Streams = (route) =>
    mockServer({ ...options, room: route.kind === 'room' ? { slug: route.slug, logins: rooms.loginsFor(route.slug) } : null }).connect;
  const campaign = () => mockServer({ ...options, room: null });
  streams = serverFor;
  api = mockApi({
    standings: () => campaign().standings(),
    profile: (id) => campaign().profile(id),
    rooms: rooms.rooms,
    createRoom: rooms.createRoom,
  });
}

createRoot(document.getElementById('root')!).render(<Root api={api} streams={streams} mock={isMock} />);
