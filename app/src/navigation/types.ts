import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

// The bottom tabs — the root navigator once signed in.
export type TabParamList = {
  Home: NavigatorScreenParams<HomeStackParamList>;
  Leaderboard: NavigatorScreenParams<LeaderboardStackParamList>;
  Tournaments: NavigatorScreenParams<TournamentsStackParamList>;
  Doubles: NavigatorScreenParams<DoublesStackParamList>;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
};

// The Home tab is a stack so it can push the Submit-match screen.
export type HomeStackParamList = {
  Home: undefined;
  SubmitMatch: undefined;
  HowRatingsWork: undefined;
};

export type HomeStackScreenProps<T extends keyof HomeStackParamList> =
  NativeStackScreenProps<HomeStackParamList, T>;

// The Leaderboard tab is a stack so a row can open a player's profile.
export type LeaderboardStackParamList = {
  Leaderboard: undefined;
  PlayerProfile: { playerId: string; displayName: string };
  HowRatingsWork: undefined;
};

export type LeaderboardStackScreenProps<T extends keyof LeaderboardStackParamList> =
  NativeStackScreenProps<LeaderboardStackParamList, T>;

// The Profile tab is a stack so "View my stats" can open the same profile screen.
export type ProfileStackParamList = {
  Account: undefined;
  PlayerProfile: { playerId: string; displayName: string };
  HowRatingsWork: undefined;
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

// The Doubles tab is a stack: the hub -> record a doubles match / how it works.
export type DoublesStackParamList = {
  DoublesHome: undefined;
  RecordDoublesMatch: undefined;
  HowRatingsWork: undefined;
};

export type DoublesStackScreenProps<T extends keyof DoublesStackParamList> =
  NativeStackScreenProps<DoublesStackParamList, T>;
