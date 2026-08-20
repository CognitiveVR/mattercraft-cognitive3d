# @cognitive3d/three-mattercraft

This package seamlessly integrates the [Cognitive3D WebXR SDK](https://github.com/CognitiveVR/c3d-sdk-webxr) into Zappar's Mattercraft platform. It leverages Mattercraft's native component architecture to transform complex analytics tracking into simple visual tools directly within the editor UI.

## Installation

### Install via NPM

In the add-ons and dependencies of Mattercraft, search for `@cognitive3d/three-mattercraft`

## Features

* **Quick Setup:** Add the Cognitive3D Manager directly to your scene hierarchy.
* **UI Properties Panel:** Easily paste your API keys and Scene data.
* **Dynamic Object Tracking:** Select any 3D model in your Mattercraft project and attach the `Cognitive3DDynamicObject` behavior to track positions, rotations, and heatmaps.
* **Scene and Dynamic Object Export:** Press `Shift+E` inside Mattercraft preview to export your environment for the dashboard. Press `Shift+D` to export dynamic objects.
  * **NOTE** : Ensure the Scene Export toggle is enabled and you save your scene to export data. You can find this setting under the Cognitive3D Behavior component in your scene hierarchy. Disable the toggle after the export is complete. 
