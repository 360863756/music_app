import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { PlaylistEntity } from './Playlist.entity';
import { TrackEntity } from './Track.entity';

/**
 *  - (playlistId, sortOrder) 复合：详情页按顺序读
 *  - (trackId) 单列：删除歌曲时级联、以及"这首歌在哪些歌单里"反查
 */
@Entity('playlist_tracks')
@Index('idx_pt_playlist_sort', ['playlistId', 'sortOrder'])
@Index('idx_pt_track', ['trackId'])
export class PlaylistTrackEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int' })
  playlistId!: number;

  @ManyToOne(() => PlaylistEntity, (p) => p.tracks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'playlistId' })
  playlist!: PlaylistEntity;

  @Column({ type: 'int' })
  trackId!: number;

  @ManyToOne(() => TrackEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'trackId' })
  track!: TrackEntity;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;
}
