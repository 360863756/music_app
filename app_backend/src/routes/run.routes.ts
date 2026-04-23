import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';
import * as run from '../interfaces/http/run.controller';

const router: import('express').Router = Router();

router.get('/tracks', run.searchTracks);
router.get('/tracks/:id', run.getTrack);
router.post('/bpm/classify', run.classifyBpm);
router.get('/onboarding/reference-tracks', run.onboardingReferenceTracks);
router.post('/onboarding/recommend', run.onboardingRecommend);

router.get('/templates', run.listMotionTemplates);
router.get('/templates/:code', run.getMotionTemplate);
router.post('/templates', optionalAuthenticate, run.createMotionTemplate);

router.get('/playlists', authenticate, run.listPlaylists);
router.post('/playlists', authenticate, run.createPlaylist);
router.get('/playlists/:id', authenticate, run.getPlaylistDetail);
router.patch('/playlists/:id', authenticate, run.updatePlaylist);
// 对齐 uni.request 的 method 白名单，前端走 PUT 更稳；两者均可
router.put('/playlists/:id', authenticate, run.updatePlaylist);
router.delete('/playlists/:id', authenticate, run.deletePlaylist);
router.post('/playlists/:id/tracks', authenticate, run.addPlaylistTrack);
router.delete('/playlists/:id/tracks/:trackId', authenticate, run.removePlaylistTrack);
router.put('/playlists/:id/reorder', authenticate, run.reorderPlaylistTracks);
router.get('/playlists/:id/export', authenticate, run.exportPlaylist);
router.get('/playlists/:id/share-code', authenticate, run.getPlaylistShareCode);
router.post('/playlists/import', authenticate, run.importPlaylistByShareCode);

export default router;
