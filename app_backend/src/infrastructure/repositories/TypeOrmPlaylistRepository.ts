import { Repository, DataSource } from 'typeorm';
import type { IPlaylistRepository } from '../../domain/playlist/IPlaylistRepository';
import { Playlist } from '../../domain/playlist/Playlist';
import type { MotionForm } from '../../domain/motion/MotionForm';
import { PlaylistEntity } from '../persistence/Playlist.entity';
import { PlaylistTrackEntity } from '../persistence/PlaylistTrack.entity';

export class TypeOrmPlaylistRepository implements IPlaylistRepository {
  constructor(
    private readonly playlistRepo: Repository<PlaylistEntity>,
    private readonly ptRepo: Repository<PlaylistTrackEntity>
  ) {}

  static fromDataSource(ds: DataSource): TypeOrmPlaylistRepository {
    return new TypeOrmPlaylistRepository(
      ds.getRepository(PlaylistEntity),
      ds.getRepository(PlaylistTrackEntity)
    );
  }

  private async toDomain(p: PlaylistEntity): Promise<Playlist> {
    const pts = await this.ptRepo.find({
      where: { playlistId: p.id },
      order: { sortOrder: 'ASC' },
    });
    return new Playlist({
      id: p.id,
      userId: p.userId,
      name: p.name,
      description: p.description,
      motionForm: (p.motionForm as MotionForm) ?? null,
      items: pts.map((x) => ({ trackId: x.trackId, sortOrder: x.sortOrder })),
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  }

  async listByUser(userId: number): Promise<Playlist[]> {
    const list = await this.playlistRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
    const out: Playlist[] = [];
    for (const p of list) {
      out.push(await this.toDomain(p));
    }
    return out;
  }

  async findByIdForUser(playlistId: number, userId: number): Promise<Playlist | null> {
    const p = await this.playlistRepo.findOne({ where: { id: playlistId, userId } });
    if (!p) return null;
    return this.toDomain(p);
  }

  async create(
    userId: number,
    name: string,
    description?: string,
    motionForm?: MotionForm
  ): Promise<Playlist> {
    const row = this.playlistRepo.create({
      userId,
      name,
      description: description ?? null,
      motionForm: motionForm ?? null,
    });
    await this.playlistRepo.save(row);
    return this.toDomain(row);
  }

  async updateMeta(
    playlistId: number,
    userId: number,
    data: { name?: string; description?: string; motionForm?: MotionForm | null }
  ): Promise<Playlist | null> {
    const p = await this.playlistRepo.findOne({ where: { id: playlistId, userId } });
    if (!p) return null;
    if (data.name !== undefined) p.name = data.name;
    if (data.description !== undefined) p.description = data.description;
    if (data.motionForm !== undefined) p.motionForm = data.motionForm;
    await this.playlistRepo.save(p);
    return this.toDomain(p);
  }

  async delete(playlistId: number, userId: number): Promise<boolean> {
    const res = await this.playlistRepo.delete({ id: playlistId, userId });
    return (res.affected ?? 0) > 0;
  }

  async setTracks(playlistId: number, userId: number, trackIds: number[]): Promise<Playlist | null> {
    const p = await this.playlistRepo.findOne({ where: { id: playlistId, userId } });
    if (!p) return null;
    await this.ptRepo.delete({ playlistId });
    let order = 0;
    for (const trackId of trackIds) {
      await this.ptRepo.save(
        this.ptRepo.create({ playlistId, trackId, sortOrder: order++ })
      );
    }
    return this.toDomain(p);
  }

  async addTrack(playlistId: number, userId: number, trackId: number): Promise<Playlist | null> {
    const p = await this.playlistRepo.findOne({ where: { id: playlistId, userId } });
    if (!p) return null;
    const existing = await this.ptRepo.findOne({ where: { playlistId, trackId } });
    if (existing) return this.toDomain(p);
    const raw = await this.ptRepo
      .createQueryBuilder('pt')
      .select('MAX(pt.sortOrder)', 'm')
      .where('pt.playlistId = :pid', { pid: playlistId })
      .getRawOne();
    const maxVal = raw?.m != null ? parseInt(String(raw.m), 10) : -1;
    const next = (Number.isFinite(maxVal) ? maxVal : -1) + 1;
    await this.ptRepo.save(this.ptRepo.create({ playlistId, trackId, sortOrder: next }));
    return this.toDomain(p);
  }

  async removeTrack(playlistId: number, userId: number, trackId: number): Promise<Playlist | null> {
    const p = await this.playlistRepo.findOne({ where: { id: playlistId, userId } });
    if (!p) return null;
    await this.ptRepo.delete({ playlistId, trackId });
    return this.toDomain(p);
  }

  async reorderTracks(
    playlistId: number,
    userId: number,
    trackIdsInOrder: number[]
  ): Promise<Playlist | null> {
    const p = await this.playlistRepo.findOne({ where: { id: playlistId, userId } });
    if (!p) return null;
    const current = await this.ptRepo.find({ where: { playlistId } });
    const idSet = new Set(current.map((c) => c.trackId));
    for (const tid of trackIdsInOrder) {
      if (!idSet.has(tid)) return null;
    }
    if (trackIdsInOrder.length !== current.length) return null;
    let order = 0;
    for (const trackId of trackIdsInOrder) {
      await this.ptRepo.update({ playlistId, trackId }, { sortOrder: order++ });
    }
    return this.toDomain(p);
  }
}
