# @cognitive3d/three-mattercraft

This package seamlessly integrates the [Cognitive3D WebXR SDK](https://github.com/CognitiveVR/c3d-sdk-webxr) into Zappar's Mattercraft platform. It leverages Mattercraft's native component architecture to transform complex analytics tracking into simple visual tools directly within the editor UI.

## Installation

### Install via NPM

In the add-ons and dependencies of Mattercraft, search for `@cognitive3d/three-mattercraft`

## Features

* **Quick Setup:** Add the Cognitive3D Manager directly to your scene hierarchy.
* **UI Properties Panel:** Easily paste your API keys and Scene data.
* **Dynamic Object Tracking:** Select any 3D model in your Mattercraft project and attach the `Cognitive3DDynamicObject` behavior to track positions, rotations, and heatmaps.
* **Room Capture:** Records the participant's real-world room (walls, floors, furniture) as labelled anchors. Toggled with `Enable Room Capture`.
* **Fixations:** Records dispersion-classified fixations from the gaze stream. Toggled with `Enable Fixations`.
* **Remote Variables:** Fetches per-participant variables from the dashboard and exposes them to your own behaviors.
* **Scene and Dynamic Object Export:** Press `Shift+E` inside Mattercraft preview to export your environment for the dashboard. Press `Shift+D` to export dynamic objects.
  * **NOTE** : Ensure the Scene Export toggle is enabled and you save your scene to export data. You can find this setting under the Cognitive3D Behavior component in your scene hierarchy. Disable the toggle after the export is complete. 

## Room Capture, Fixations and Remote Variables

These three features come from the underlying WebXR SDK and require a version of
`@cognitive3d/analytics` that ships them. Against an older SDK the integration detects
their absence and stays inactive, so nothing breaks.

### Room Capture

Room Capture reads the room model the headset already holds, so two conditions apply on
Quest:

* The session must be **`immersive-ar`**. In `immersive-vr` the runtime reports
  `plane-detection` as enabled but never returns any planes.
* The participant must have completed **Space Setup** on the headset. Without an authored
  room there is nothing to capture.

Mattercraft's own XR session does not request the geometry features, so this behavior adds
`plane-detection` and `mesh-detection` to the requested optional features while
`Enable Room Capture` is on. Both are optional, so runtimes without support are unaffected.
Enable debug logging to see which features the runtime granted.

### Fixations

Fixations are classified from the gaze stream the Mattercraft adapter already records, so
no extra setup is needed. They are only recorded on headsets that report eye tracking,
which matches the Unity SDK. Set `Allow Fixations Without Eye Tracking` to also classify
fixations from the head-gaze fallback.

### Remote Variables

With `Fetch Remote Variables` enabled the SDK fetches the participant's variables when the
session starts. Read them from the shared context:

```ts
import { Cognitive3DContext } from "@cognitive3d/three-mattercraft";

const c3d = this.contextManager.get(Cognitive3DContext);

c3d.onRemoteVariablesAvailable.addListener(() => {
    const difficulty = c3d.getRemoteVariable("difficulty", "normal");
    const showHints = c3d.getRemoteVariable("show_hints", false);
});
```

`getRemoteVariable(name, defaultValue)` returns the default until the fetch resolves, so it
is always safe to call. `listRemoteVariables()` returns everything that resolved, and
`fetchRemoteVariables(identifier)` triggers a fetch manually.
