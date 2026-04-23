import type { MotionForm } from '../motion/MotionForm';
import type { Playlist } from './Playlist';

export interface IPlaylistRepository {
  listByUser(userId: number): Promise<Playlist[]>;
  findByIdForUser(playlistId: number, userId: number): Promise<Playlist | null>;
  create(userId: number, name: string, description?: string, motionForm?: MotionForm): Promise<Playlist>;
  updateMeta(
    playlistId: number,
    userId: number,
    data: { name?: string; description?: string | null; motionForm?: MotionForm | null }
  ): Promise<Playlist | null>;
  delete(playlistId: number, userId: number): Promise<boolean>;
  setTracks(playlistId: number, userId: number, trackIds: number[]): Promise<Playlist | null>;
  addTrack(playlistId: number, userId: number, trackId: number): Promise<Playlist | null>;
  removeTrack(playlistId: number, userId: number, trackId: number): Promise<Playlist | null>;
  reorderTracks(playlistId: number, userId: number, trackIdsInOrder: number[]): Promise<Playlist | null>;
}
