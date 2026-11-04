import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { OrderStateProvider } from './context/OrderStateContext';
import { CartProvider } from './context/CartContext';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './index.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter><OrderStateProvider><CartProvider><App /></CartProvider></OrderStateProvider></BrowserRouter></React.StrictMode>);
