import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import Approval from './components/Approval.vue'

// The extension opens its approval window at #/approve; the toolbar popup
// passes ?popup=1 so the layout fits the popup's fixed width.
if (new URLSearchParams(location.search).has('popup')) document.documentElement.classList.add('popup')
createApp(location.hash.startsWith('#/approve') ? Approval : App).mount('#app')
