import * as THREE from 'three';

export class LoaderSystemManager {
    constructor(onAllLoadedCallback) {
        this.manager = new THREE.LoadingManager();
        this.onAllLoadedCallback = onAllLoadedCallback;
        
        this.manager.onStart = (url, itemsLoaded, itemsTotal) => {
            console.log(`Started loading: ${url}. Loaded ${itemsLoaded}/${itemsTotal} items.`);
        };
        
        this.manager.onLoad = () => {
            console.log('All resources loaded successfully!');
            if (this.onAllLoadedCallback) this.onAllLoadedCallback();
        };
        
        this.manager.onProgress = (url, itemsLoaded, itemsTotal) => {
            const progress = Math.round((itemsLoaded / itemsTotal) * 100);
            console.log(`Loading progress: ${progress}%`);
            // Dynamic DOM dispatch if selector exists
            const progressEl = document.getElementById('loading-percentage');
            if (progressEl) {
                progressEl.innerText = `${progress}%`;
            }
        };
        
        this.manager.onError = (url) => {
            console.error(`There was an error loading: ${url}`);
        };
    }

    getLoadingManager() {
        return this.manager;
    }
}
