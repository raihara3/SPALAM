import './style.css';
import { ARRenderer } from './ARRenderer';

declare const cv: any;
let arRenderer: ARRenderer | null = null;

// OpenCVの読み込み完了時のコールバック
(window as any).onOpenCvReady = () => {
    console.log('OpenCV.js is ready');
    arRenderer = new ARRenderer(cv);
    arRenderer.initialize();
};
