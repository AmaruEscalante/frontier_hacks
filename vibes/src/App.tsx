import React, { useRef, useState } from 'react';
import './App.scss';
import { LiveAPIProvider } from './contexts/LiveAPIContext';
import VibesApp from './components/VibesApp';
import SidePanel from './components/side-panel/SidePanel';
import ControlTray from './components/control-tray/ControlTray';
import { LiveClientOptions } from './types';
import cn from 'classnames';

const API_KEY = process.env.REACT_APP_GEMINI_API_KEY as string;
if (typeof API_KEY !== 'string') {
  throw new Error('set REACT_APP_GEMINI_API_KEY in .env');
}

const apiOptions: LiveClientOptions = {
  apiKey: API_KEY,
};

function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);

  return (
    <div className="App">
      <LiveAPIProvider options={apiOptions}>
        <SidePanel />
        <main className="main-content">
          <VibesApp />
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn("stream", {
              hidden: !videoRef.current || !videoStream,
            })}
          />
        </main>
        <ControlTray
          videoRef={videoRef}
          supportsVideo={true}
          onVideoStreamChange={setVideoStream}
        />
      </LiveAPIProvider>
    </div>
  );
}

export default App;
