import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './renderer/providers/AppProviders';
import { App } from './renderer/components/App';
import './renderer/styles/index.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  React.createElement(AppProviders, null, React.createElement(App))
);
