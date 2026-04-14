import { Component, Behavior, ContextManager, useOnBeforeRender, started } from "@zcomponent/core";
import { XRContext } from "@zcomponent/three-webxr";
import { ThreeContext, ThreeSceneContext, OnBeforeRenderPriority } from "@zcomponent/three";
import * as THREE from "three";
import { EditorContext } from "@zcomponent/three/lib/editorcontext";

import C3D from "./vendor/c3d-bundle-threejs.umd.js";
import { Cognitive3DContext, IDynamicObjectBehavior } from "./Cognitive3DContext";

export { IDynamicObjectBehavior } from "./Cognitive3DContext";

export interface Cognitive3DConstructionProps {
    /** @zui */
    apiKey: string;
    /** @zui */
    sceneId: string;
    /** @zui */
    sceneName: string;
    /** @zui */
    sceneVersion?: string;
    /**
     * @zui
     * @zlabel App Version
     * @zdefault "1.0"
     */
    appVersion: string;
    /**
     * @zui
     * @zlabel Toggle Export
     * @zdefault false
     */
    enableExport: boolean;
    /**
     * @zui
     * @zlabel Enable Debug Logging
     * @zdefault false
     */
    enableDebug: boolean;

}

/**
 * @zbehavior
 * @zdescription Cognitive3D Integration
 * @ztag three/Object3D/Analytics/Cognitive3D
 * @zparents three/Object3D/**
 * @zicon analytics
 */
export class Cognitive3D extends Behavior<Component> {

    private ctx: Cognitive3DContext;

    private c3d: any | null = null;
    private c3dAdapter: any = null;
    private xrContext: XRContext;
    private threeContext: ThreeContext;
    private sceneContext: ThreeSceneContext;
    private _xrSession: XRSession | null = null;
    private _xrSessionEndHandler: (() => void) | null = null;

    constructor(contextManager: ContextManager, instance: Component, protected constructorProps: Cognitive3DConstructionProps) {
        super(contextManager, instance);

        // Get or create the shared context
        this.ctx = this.contextManager.get(Cognitive3DContext);

        // Pick up any behaviors constructed before the manager was ready
        this.ctx.pendingRegistrations.forEach(b => this.ctx.trackedBehaviors.add(b));
        this.ctx.pendingRegistrations = [];

        this.threeContext = this.contextManager.get(ThreeContext);
        this.sceneContext = this.contextManager.get(ThreeSceneContext);
        this.xrContext = this.contextManager.get(XRContext);

        try {
            this.c3d = new C3D({
                config: {
                    APIKey: this.constructorProps.apiKey,
                    LOG: this.constructorProps.enableDebug,
                    gazeTrackingSource: "engine",
                    allSceneData: [{
                        sceneId: this.constructorProps.sceneId,
                        sceneName: this.constructorProps.sceneName,
                        versionNumber: this.constructorProps.sceneVersion || "1"
                    }]
                }
            });

            this.c3dAdapter = new (C3D as any).Adapter(this.c3d);

            if (this.constructorProps.sceneName) {
                this.c3d.setScene(this.constructorProps.sceneName);
            }
            this.c3d.setDeviceProperty("AppEngine", "MatterCraft");
            this.c3d.setAppVersion(this.constructorProps.appVersion || "1.0");

            // Publish SDK references into the shared context
            this.ctx.c3d = this.c3d;
            this.ctx.c3dAdapter = this.c3dAdapter;
            this.ctx.sceneName = this.constructorProps.sceneName;
            this.ctx.enableDebug = this.constructorProps.enableDebug;
            this.ctx.registerDynamicObject = (b) => this.registerDynamicObject(b);

            if (this.xrContext) {
                this.register(this.xrContext.currentSession, (session: XRSession | null) => {
                    this.handleSessionChange(session);
                });
            }

            this.register(
                useOnBeforeRender(this.contextManager),
                (_dt: number) => {
                    if (this.c3dAdapter) {
                        this.c3dAdapter.update();
                    }
                },
                OnBeforeRenderPriority.AfterTransforms
            );

            window.addEventListener('keydown', this.handleKeyDown);

        } catch (err) {
            console.error("Cognitive3D: Init Failed", err);
        }
    }

    public registerDynamicObject(behavior: IDynamicObjectBehavior) {
        // Add to the internal registry so we can re-initialize on session start
        this.ctx.trackedBehaviors.add(behavior);

        if (!this.c3d || !this.c3dAdapter || !this.c3d.isSessionActive()) {
            return;
        }

        // Prevent double-registration with the C3D SDK
        if (this.ctx.registeredWithSDK.has(behavior)) {
            return;
        }

        const groupObj = behavior.getTrackedObject();
        const props = behavior.getProps();

        if (!groupObj) {
            console.warn("Cognitive3D: Dynamic Object has no Three.js element yet.");
            return;
        }

        const fallbackName = groupObj.name || "UnnamedObject";
        const meshName = props.c3dMeshName || fallbackName;
        const objectName = meshName;
        const customId = props.c3dCustomId || groupObj.uuid;

        // scene.updateMatrixWorld(true) is called once before the registration
        // loop in handleSessionChange, so the full scene is already up to date.
        groupObj.updateWorldMatrix(true, true);
        const worldPos = new THREE.Vector3();
        const worldQuat = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();
        groupObj.matrixWorld.decompose(worldPos, worldQuat, worldScale);

        const runtimeId = this.c3d.dynamicObject.registerObjectCustomId(
            objectName,
            meshName,
            customId,
            [worldPos.x, worldPos.y, worldPos.z * -1],
            [worldQuat.x, worldQuat.y, worldQuat.z * -1, worldQuat.w * -1],
            [worldScale.x, worldScale.y, worldScale.z]
        );

        groupObj.userData.c3dId = runtimeId;
        this.ctx.registeredWithSDK.add(behavior);

        this.c3dAdapter.trackDynamicObject(groupObj, runtimeId, {
            positionThreshold: props.positionThreshold,
            rotationThreshold: props.rotationThreshold
        });

        if (typeof this.c3dAdapter.addInteractable === 'function') {
            let raycastTarget: THREE.Object3D = groupObj;

            if (!this.hasGeometry(groupObj)) {
                const scene = this.sceneContext.scene;
                scene.traverse((node) => {
                    if (node.name === objectName && this.hasGeometry(node)) {
                        raycastTarget = node;
                    }
                });

                if (raycastTarget !== groupObj) {
                    this.ctx.debug(`Cognitive3D: Swapped empty tracker '${objectName}' for visual node in raycaster.`);
                }
            }

            raycastTarget.userData.c3dId = runtimeId;
            this.c3dAdapter.addInteractable(raycastTarget);
            this.ctx.debug(`Cognitive3D: Raycasting enabled for full object ${objectName}`);
        }

        this.ctx.debug(`Cognitive3D: Dynamic Object Registered: ${objectName}`);
    }

    public unregisterDynamicObject(behavior: IDynamicObjectBehavior) {
        this.ctx.trackedBehaviors.delete(behavior);
    }

    private hasGeometry(obj: THREE.Object3D): boolean {
        let hasGeom = false;
        obj.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                hasGeom = true;
            }
        });
        return hasGeom;
    }

    private async handleSessionChange(session: XRSession | null) {
        if (!this.c3d) return;

        if (session === null) {
            if (this.c3d.isSessionActive()) await this.c3d.endSession();
            this.ctx.registeredWithSDK.clear();
            return;
        }

        try {
            if (this.c3d.isSessionActive()) await this.c3d.endSession();
            this.ctx.registeredWithSDK.clear();

            // Remove any stale "end" listener from the previous session
            if (this._xrSession && this._xrSessionEndHandler) {
                this._xrSession.removeEventListener("end", this._xrSessionEndHandler);
            }

            this._xrSessionEndHandler = () => {
                if (this.c3d && this.c3d.isSessionActive()) this.c3d.endSession();
                this.ctx.registeredWithSDK.clear();
            };
            this._xrSession = session;
            session.addEventListener("end", this._xrSessionEndHandler);

            const success = await this.c3d.startSession(session);

            if (success) {
                this.ctx.debug("Cognitive3D: Session Started");

                const renderer = this.threeContext.renderer as THREE.WebGLRenderer;
                const scene = this.sceneContext.scene;
                const trackingCamera = this.sceneContext.activeCamera.value;

                if (renderer && trackingCamera) {
                    (this.c3d as any).config.gazeTrackingSource = "engine";
                    this.c3dAdapter?.startTracking(renderer, trackingCamera as THREE.Camera, scene);
                }

                started(this.contextManager).then(() => {
                    this.sceneContext.scene.updateMatrixWorld(true);

                    let initCount = 0;
                    this.ctx.trackedBehaviors.forEach(behavior => {
                         this.registerDynamicObject(behavior);
                         initCount++;
                    });

                    this.ctx.debug(`Cognitive3D: Force-registered ${initCount} existing dynamic objects after layout sync.`);
                });
            }
        } catch (err) {
            console.error("Cognitive3D: Error starting session", err);
        }
    }

    private handleKeyDown = (event: KeyboardEvent) => {
        if (!this.constructorProps.enableExport) {
            return;
        }

        if (event.shiftKey && (event.key === 'E' || event.key === 'e')) {
            this.exportScene();
        }
        if (event.shiftKey && (event.key === 'D' || event.key === 'd')) {
            this.exportDynamicObjects();
        }
    }

    private async exportDynamicObjects() {
        if (!this.c3dAdapter) {
            console.warn("Cognitive3D: Cannot export, adapter not initialized.");
            return;
        }

        const renderer = this.threeContext.renderer;
        const camera = this.sceneContext.activeCamera.value;

        if (!renderer || !camera) {
            console.warn("Cognitive3D: Missing Renderer or Camera for export.");
            return;
        }

        this.ctx.debug(`Cognitive3D: Checking ${this.ctx.trackedBehaviors.size} Dynamic Objects for export...`);

        const dynamicNames = new Set<string>();
        for (const behavior of Array.from(this.ctx.trackedBehaviors)) {
            const wrapper = behavior.getTrackedObject();
            const props = behavior.getProps();
            if (wrapper) {
                const fallbackName = wrapper.name || "UnnamedObject";
                dynamicNames.add(props.c3dMeshName || fallbackName);
            }
        }

        const exportedMeshes = new Set<string>();

        for (const behavior of Array.from(this.ctx.trackedBehaviors)) {
            const wrapper = behavior.getTrackedObject();
            const props = behavior.getProps();

            if (wrapper) {
                const fallbackName = wrapper.name || "UnnamedObject";
                const exportName = props.c3dMeshName || fallbackName;

                if (exportedMeshes.has(exportName)) {
                    this.ctx.debug(`Cognitive3D: Skipping duplicate Dynamic Object export: '${exportName}'`);
                    continue;
                }

                exportedMeshes.add(exportName);

                this.ctx.debug("------------------------------------------------");
                this.ctx.debug(`Cognitive3D: Exporting Dynamic Object: '${exportName}'`);
                this.ctx.debug("------------------------------------------------");

                let objToExport = wrapper.clone();

                if (!this.hasGeometry(objToExport)) {
                    const scene = this.sceneContext.scene;
                    let foundVisualNode: THREE.Object3D | null = null;
                    scene.traverse((node) => {
                        if (node.name === exportName && this.hasGeometry(node)) {
                            foundVisualNode = node;
                        }
                    });

                    if (foundVisualNode as any) {
                        objToExport = (foundVisualNode as any).clone();
                        this.ctx.debug(`Cognitive3D: Found actual visual geometry for '${exportName}' in scene.`);
                    } else {
                        console.warn(`Cognitive3D: Could not find visual geometry for '${exportName}'. Exporting as empty group.`);
                    }
                }

                const nodesToRemove: THREE.Object3D[] = [];
                objToExport.traverse((node) => {
                    if (node === objToExport) return;
                    if (dynamicNames.has(node.name)) {
                        nodesToRemove.push(node);
                    }
                });

                nodesToRemove.forEach(node => {
                    if (node.parent) {
                        node.parent.remove(node);
                    }
                });

                objToExport.position.set(0, 0, 0);
                objToExport.quaternion.identity();
                objToExport.scale.set(1, 1, 1);
                objToExport.updateMatrixWorld(true);

                const exportRoot = new THREE.Group();
                exportRoot.name = "CoordinateSystemFix";
                exportRoot.add(objToExport);
                exportRoot.scale.z = -1;
                exportRoot.scale.x = -1;

                if (typeof this.c3dAdapter.exportObject === 'function') {
                    await this.c3dAdapter.exportObject(
                        exportRoot,
                        exportName,
                        renderer as THREE.WebGLRenderer,
                        camera
                    );
                } else {
                    console.error("Cognitive3D: c3dAdapter.exportObject function not found. Please update the C3DThreeAdapter.");
                }
            }
        }
    }

    private exportScene() {
        if (!this.c3dAdapter) return;
        const renderer = this.threeContext.renderer as THREE.WebGLRenderer;
        const scene = this.sceneContext.scene;
        let camera = this.sceneContext.activeCamera.value;

        // 1. Attempt to get the Editor's camera so the screenshot matches your editor view
        try {
            const editorContext = this.contextManager.get(EditorContext);
            if (editorContext && editorContext.orbitControls.value) {
                camera = editorContext.orbitControls.value.object as THREE.Camera;
                this.ctx.debug("Cognitive3D: Using Editor camera for export.");
            }
        } catch (e) {
            this.ctx.debug("Cognitive3D: Editor environment not found, using active camera.");
        }

        if (renderer && scene && camera) {
            this.ctx.debug("Cognitive3D: Exporting Scene...");

            // 2. Temporarily strip C3D userData from the entire scene.
            const strippedUserData: { obj: THREE.Object3D, isDynamic?: boolean, c3dId?: string }[] = [];

            scene.traverse((obj) => {
                if (obj.userData && (obj.userData.c3dId !== undefined || obj.userData.isDynamic !== undefined)) {
                    strippedUserData.push({
                        obj,
                        isDynamic: obj.userData.isDynamic,
                        c3dId: obj.userData.c3dId
                    });

                    delete obj.userData.isDynamic;
                    delete obj.userData.c3dId;
                }
            });

            // 3. Hide dynamic object roots so the GLTFExporter explicitly ignores them
            const hiddenObjects: { obj: THREE.Object3D, originalVisibility: boolean }[] = [];

            this.ctx.trackedBehaviors.forEach(behavior => {
                const obj = behavior.getTrackedObject();
                if (obj) {
                    hiddenObjects.push({ obj, originalVisibility: obj.visible });
                    obj.visible = false;
                }
            });

            // 4. FORCE RENDER: Draw the scene to the buffer right before export to prevent blank screenshots
            renderer.render(scene, camera);

            // 5. Export Scene
            const exportName = this.constructorProps.sceneName || "Unnamed-MatterCraft-Scene";
            this.c3dAdapter.exportScene(scene, exportName, renderer, camera);

            // 6. Safely restore the live scene's visibility and userData immediately
            hiddenObjects.forEach(({ obj, originalVisibility }) => {
                obj.visible = originalVisibility;
            });

            strippedUserData.forEach(({ obj, isDynamic, c3dId }) => {
                if (isDynamic !== undefined) obj.userData.isDynamic = isDynamic;
                if (c3dId !== undefined) obj.userData.c3dId = c3dId;
            });

            this.ctx.debug(`Cognitive3D: Scene '${exportName}' Exported & Dynamic Objects Restored.`);
        }
    }

    public override dispose() {
        window.removeEventListener('keydown', this.handleKeyDown);

        if (this._xrSession && this._xrSessionEndHandler) {
            this._xrSession.removeEventListener("end", this._xrSessionEndHandler);
        }

        if (this.c3d && this.c3d.isSessionActive()) {
            this.c3d.endSession();
        }

        this.c3d = null;
        this.c3dAdapter = null;
        this.ctx.c3d = null;
        this.ctx.c3dAdapter = null;
        this.ctx.registerDynamicObject = null;
        this.ctx.trackedBehaviors.clear();
        this.ctx.registeredWithSDK.clear();

        return super.dispose();
    }
}
