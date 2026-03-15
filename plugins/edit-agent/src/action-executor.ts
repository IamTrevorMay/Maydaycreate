import type { PluginContext, Sequence } from '@mayday/sdk';
import type { EditProposal } from './types.js';

export async function executeProposal(ctx: PluginContext, proposal: EditProposal, sequence: Sequence): Promise<boolean> {
  const { action } = proposal;
  const { timeline } = ctx.services;

  // Validate track exists and is not locked
  const tracks = action.trackType === 'audio' ? sequence.audioTracks : sequence.videoTracks;
  if (action.trackIndex >= tracks.length) {
    ctx.log.error(`Track ${action.trackType} ${action.trackIndex} does not exist`);
    return false;
  }

  const track = tracks[action.trackIndex];
  if (track.locked) {
    ctx.log.error(`Track ${action.trackType} ${action.trackIndex} is locked`);
    return false;
  }

  // Validate clip exists (for operations that reference a clip)
  if (['split', 'trim-head', 'trim-tail', 'delete', 'move', 'enable', 'disable'].includes(action.type)) {
    if (action.clipIndex >= track.clips.length) {
      ctx.log.error(`Clip ${action.clipIndex} does not exist on track ${action.trackType} ${action.trackIndex}`);
      return false;
    }
  }

  try {
    switch (action.type) {
      case 'split': {
        if (action.params.splitTime == null) return false;
        return await timeline.splitClip(action.trackIndex, action.clipIndex, action.trackType, action.params.splitTime);
      }

      case 'trim-head': {
        if (action.params.newInPoint == null) return false;
        const clip = track.clips[action.clipIndex];
        return await timeline.setClipInOutPoints(
          action.trackIndex as any, action.clipIndex as any,
          action.params.newInPoint, clip.outPoint
        );
      }

      case 'trim-tail': {
        if (action.params.newOutPoint == null) return false;
        const clip = track.clips[action.clipIndex];
        return await timeline.setClipInOutPoints(
          action.trackIndex as any, action.clipIndex as any,
          clip.inPoint, action.params.newOutPoint
        );
      }

      case 'delete': {
        if (action.params.ripple) {
          return await timeline.rippleDelete(action.trackIndex, action.clipIndex, action.trackType);
        } else {
          return await timeline.liftClip(action.trackIndex, action.clipIndex, action.trackType);
        }
      }

      case 'insert': {
        if (action.params.insertTime == null || action.params.projectItemPath == null) return false;
        return await timeline.insertClip(action.trackIndex, action.trackType, action.params.projectItemPath, action.params.insertTime);
      }

      case 'move': {
        if (action.params.moveToTime == null) return false;
        const clip = track.clips[action.clipIndex];
        // Lift clip (leaves gap), then insert at new position
        const liftOk = await timeline.liftClip(action.trackIndex, action.clipIndex, action.trackType);
        if (!liftOk) return false;
        // Insert same media at new position
        const insertOk = await timeline.insertClip(action.trackIndex, action.trackType, clip.mediaPath, action.params.moveToTime);
        if (!insertOk) return false;
        // Restore original in/out points on newly inserted clip
        // The new clip will be somewhere on the track — find it by re-reading
        return true;
      }

      case 'enable': {
        return await timeline.setClipEnabled(action.trackIndex, action.clipIndex, action.trackType, true);
      }

      case 'disable': {
        return await timeline.setClipEnabled(action.trackIndex, action.clipIndex, action.trackType, false);
      }

      default:
        ctx.log.error(`Unknown action type: ${action.type}`);
        return false;
    }
  } catch (err) {
    ctx.log.error(`Failed to execute ${action.type}:`, err);
    return false;
  }
}
