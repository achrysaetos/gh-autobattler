import { createRoot } from 'react-dom/client';
import { App } from './hud/App.tsx';
import { httpApi, mockApi, type Api } from './net/api.ts';
import { LockstepRunner } from './net/runner.ts';
import { connectWebSocket, type Connect } from './net/transport.ts';
import { Store } from './store.ts';
import './styles.css';

let connect: Connect = connectWebSocket;
let api: Api = httpApi;
let mock: object = {};
const isMock = new URLSearchParams(location.search).has('mock');
if (isMock) {
  const { mockOptionsFromUrl, mockServer } = await import('./dev/mockServer.ts');
  const server = mockServer(mockOptionsFromUrl(location.search)!);
  connect = server.connect;
  api = mockApi(server);
  mock = { server };
}

const store = new Store();
const runner = new LockstepRunner(connect, store);
runner.start();
if (isMock) Object.assign(window, { pushfront: { store, runner, ...mock } });

createRoot(document.getElementById('root')!).render(<App store={store} runner={runner} api={api} mock={isMock} />);
