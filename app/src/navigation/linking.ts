import type { LinkingOptions } from '@react-navigation/native';

import type { TabParamList } from './types';

// Gives every screen its own URL. On the web this is what makes navigating
// push browser history, so the phone's Back button (and the browser's) steps
// back through screens instead of leaving the app. Each stack's
// `initialRouteName` keeps its list screen underneath a reloaded sub-screen,
// so the in-app back arrow still works after a refresh.
//
// Full paths go on the screens, not on the tabs: two tabs contain a screen
// with the tab's own name, and React Navigation's "/" lookup matches by name,
// so a tab path plus an empty child path made "/" open the Leaderboard.
export const linking: LinkingOptions<TabParamList> = {
  prefixes: ['pingpong://'],
  config: {
    screens: {
      Home: {
        initialRouteName: 'Home',
        screens: {
          Home: '',
          SubmitMatch: 'record',
          HowRatingsWork: 'how-ratings-work',
        },
      },
      Leaderboard: {
        initialRouteName: 'Leaderboard',
        screens: {
          Leaderboard: 'leaderboard',
          PlayerProfile: 'leaderboard/player/:playerId',
          HowRatingsWork: 'leaderboard/how-ratings-work',
        },
      },
      Tournaments: {
        initialRouteName: 'TournamentsList',
        screens: {
          TournamentsList: 'tournaments',
          CreateTournament: 'tournaments/new',
          TournamentDetail: 'tournaments/:tournamentId',
          RecordTournamentMatch: {
            path: 'tournaments/:tournamentId/match/:tournamentMatchId',
            // URL params come back as strings; the screen compares this as a number.
            parse: { bestOf: Number },
          },
        },
      },
      Doubles: {
        initialRouteName: 'DoublesHome',
        screens: {
          DoublesHome: 'doubles',
          RecordDoublesMatch: 'doubles/record',
          HowRatingsWork: 'doubles/how-ratings-work',
        },
      },
      Profile: {
        initialRouteName: 'Account',
        screens: {
          Account: 'profile',
          PlayerProfile: 'profile/stats/:playerId',
          HowRatingsWork: 'profile/how-ratings-work',
        },
      },
    },
  },
};
