import { AppDataSource } from '../config/database';
import { TypeOrmTrackRepository } from '../infrastructure/repositories/TypeOrmTrackRepository';
import { TypeOrmPlaylistRepository } from '../infrastructure/repositories/TypeOrmPlaylistRepository';
import { TypeOrmMotionTemplateRepository } from '../infrastructure/repositories/TypeOrmMotionTemplateRepository';
import { ClassifyBpmUseCase } from '../application/track/ClassifyBpmUseCase';
import { SearchTracksUseCase } from '../application/track/SearchTracksUseCase';
import { GetTrackUseCase } from '../application/track/GetTrackUseCase';
import {
  ListPlaylistsUseCase,
  GetPlaylistDetailUseCase,
  CreatePlaylistUseCase,
  UpdatePlaylistUseCase,
  DeletePlaylistUseCase,
  AddTrackToPlaylistUseCase,
  RemoveTrackFromPlaylistUseCase,
  ReorderPlaylistTracksUseCase,
} from '../application/playlist/PlaylistUseCases';
import {
  CreateMotionTemplateUseCase,
  GetMotionTemplateByShareCodeUseCase,
  ListRecentTemplatesUseCase,
} from '../application/template/MotionTemplateUseCases';
import { BuildPlaylistExportUseCase } from '../application/import/BuildPlaylistExportUseCase';
import { OnboardingRecommendUseCase } from '../application/onboarding/OnboardingRecommendUseCase';

let wired = false;

export const appContainer = {
  trackRepo: null as ReturnType<typeof TypeOrmTrackRepository.fromDataSource> | null,
  playlistRepo: null as ReturnType<typeof TypeOrmPlaylistRepository.fromDataSource> | null,
  templateRepo: null as ReturnType<typeof TypeOrmMotionTemplateRepository.fromDataSource> | null,

  classifyBpm: null as ClassifyBpmUseCase | null,
  searchTracks: null as SearchTracksUseCase | null,
  getTrack: null as GetTrackUseCase | null,
  listPlaylists: null as ListPlaylistsUseCase | null,
  getPlaylistDetail: null as GetPlaylistDetailUseCase | null,
  createPlaylist: null as CreatePlaylistUseCase | null,
  updatePlaylist: null as UpdatePlaylistUseCase | null,
  deletePlaylist: null as DeletePlaylistUseCase | null,
  addTrackToPlaylist: null as AddTrackToPlaylistUseCase | null,
  removeTrackFromPlaylist: null as RemoveTrackFromPlaylistUseCase | null,
  reorderPlaylistTracks: null as ReorderPlaylistTracksUseCase | null,
  createMotionTemplate: null as CreateMotionTemplateUseCase | null,
  getMotionTemplateByShare: null as GetMotionTemplateByShareCodeUseCase | null,
  listRecentTemplates: null as ListRecentTemplatesUseCase | null,
  buildPlaylistExport: null as BuildPlaylistExportUseCase | null,
  onboardingRecommend: null as OnboardingRecommendUseCase | null,
};

export function wireApplication(ds = AppDataSource) {
  if (wired) return;
  const trackRepo = TypeOrmTrackRepository.fromDataSource(ds);
  const playlistRepo = TypeOrmPlaylistRepository.fromDataSource(ds);
  const templateRepo = TypeOrmMotionTemplateRepository.fromDataSource(ds);

  appContainer.trackRepo = trackRepo;
  appContainer.playlistRepo = playlistRepo;
  appContainer.templateRepo = templateRepo;

  appContainer.classifyBpm = new ClassifyBpmUseCase();
  appContainer.searchTracks = new SearchTracksUseCase(trackRepo);
  appContainer.getTrack = new GetTrackUseCase(trackRepo);
  appContainer.listPlaylists = new ListPlaylistsUseCase(playlistRepo);
  appContainer.getPlaylistDetail = new GetPlaylistDetailUseCase(playlistRepo, trackRepo);
  appContainer.createPlaylist = new CreatePlaylistUseCase(playlistRepo);
  appContainer.updatePlaylist = new UpdatePlaylistUseCase(playlistRepo);
  appContainer.deletePlaylist = new DeletePlaylistUseCase(playlistRepo);
  appContainer.addTrackToPlaylist = new AddTrackToPlaylistUseCase(playlistRepo);
  appContainer.removeTrackFromPlaylist = new RemoveTrackFromPlaylistUseCase(playlistRepo);
  appContainer.reorderPlaylistTracks = new ReorderPlaylistTracksUseCase(playlistRepo);
  appContainer.createMotionTemplate = new CreateMotionTemplateUseCase(templateRepo);
  appContainer.getMotionTemplateByShare = new GetMotionTemplateByShareCodeUseCase(
    templateRepo,
    trackRepo
  );
  appContainer.listRecentTemplates = new ListRecentTemplatesUseCase(templateRepo);
  appContainer.buildPlaylistExport = new BuildPlaylistExportUseCase(playlistRepo, trackRepo);
  appContainer.onboardingRecommend = new OnboardingRecommendUseCase(trackRepo);

  wired = true;
}
