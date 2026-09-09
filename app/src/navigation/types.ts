import type { NativeStackScreenProps } from '@react-navigation/native-stack';

// The Home tab is a stack so it can push the Submit-match screen.
export type HomeStackParamList = {
  Home: undefined;
  SubmitMatch: undefined;
};

export type HomeStackScreenProps<T extends keyof HomeStackParamList> =
  NativeStackScreenProps<HomeStackParamList, T>;

// The Leaderboard tab is a stack so a row can open a player's profile.
export type LeaderboardStackParamList = {
  Leaderboard: undefined;
  PlayerProfile: { playerId: string; displayName: string };
};

export type LeaderboardStackScreenProps<T extends keyof LeaderboardStackParamList> =
  NativeStackScreenProps<LeaderboardStackParamList, T>;

// The Profile tab is a stack so "View my stats" can open the same profile screen.
export type ProfileStackParamList = {
  Account: undefined;
  PlayerProfile: { playerId: string; displayName: string };
};

export type ProfileStackScreenProps<T extends keyof ProfileStackParamList> =
  NativeStackScreenProps<ProfileStackParamList, T>;

// The Tournaments tab is a stack: list -> create / detail -> record a bracket match.
export type TournamentsStackParamList = {
  TournamentsList: undefined;
  CreateTournament: undefined;
  TournamentDetail: { tournamentId: string; name: string };
  RecordTournamentMatch: {
    tournamentMatchId: string;
    tournamentId: string;
    playerAName: string;
    playerBName: string;
    bestOf: number;
  };
};

export type TournamentsStackScreenProps<T extends keyof TournamentsStackParamList> =
  NativeStackScreenProps<TournamentsStackParamList, T>;
