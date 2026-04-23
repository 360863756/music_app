import type { IPlaylistRepository } from '../../domain/playlist/IPlaylistRepository';
import type { ITrackRepository } from '../../domain/track/ITrackRepository';
import type { MotionForm } from '../../domain/motion/MotionForm';

export class ListPlaylistsUseCase {
  constructor(private readonly playlists: IPlaylistRepository) {}
  execute(userId: number) {
    return this.playlists.listByUser(userId);
  }
}

export class GetPlaylistDetailUseCase {
  constructor(
    private readonly playlists: IPlaylistRepository,
    private readonly tracks: ITrackRepository
  ) {}

  async execute(playlistId: number, userId: number) {
    const pl = await this.playlists.findByIdForUser(playlistId, userId);
    if (!pl) return null;
    const trackRows = [];
    for (const it of pl.items) {
      const tr = await this.tracks.findById(it.trackId);
      if (tr) trackRows.push({ sortOrder: it.sortOrder, ...tr.toJSON() });
    }
    trackRows.sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      id: pl.id,
      name: pl.name,
      description: pl.description,
      motionForm: pl.motionForm,
      tracks: trackRows,
      createdAt: pl.createdAt,
      updatedAt: pl.updatedAt,
    };
  }
}

export class CreatePlaylistUseCase {
  constructor(private readonly playlists: IPlaylistRepository) {}
  execute(userId: number, name: string, description?: string, motionForm?: MotionForm) {
    return this.playlists.create(userId, name, description, motionForm);
  }
}

export class UpdatePlaylistUseCase {
  constructor(private readonly playlists: IPlaylistRepository) {}
  execute(
    playlistId: number,
    userId: number,
    data: { name?: string; description?: string | null; motionForm?: MotionForm | null }
  ) {
    return this.playlists.updateMeta(playlistId, userId, data);
  }
}

export class DeletePlaylistUseCase {
  constructor(private readonly playlists: IPlaylistRepository) {}
  execute(playlistId: number, userId: number) {
    return this.playlists.delete(playlistId, userId);
  }
}

export class AddTrackToPlaylistUseCase {
  constructor(private readonly playlists: IPlaylistRepository) {}
  execute(playlistId: number, userId: number, trackId: number) {
    return this.playlists.addTrack(playlistId, userId, trackId);
  }
}

export class RemoveTrackFromPlaylistUseCase {
  constructor(private readonly playlists: IPlaylistRepository) {}
  execute(playlistId: number, userId: number, trackId: number) {
    return this.playlists.removeTrack(playlistId, userId, trackId);
  }
}

export class ReorderPlaylistTracksUseCase {
  constructor(private readonly playlists: IPlaylistRepository) {}
  execute(playlistId: number, userId: number, trackIdsInOrder: number[]) {
    return this.playlists.reorderTracks(playlistId, userId, trackIdsInOrder);
  }
}
