import { createUsernameQuery } from "./username";
import { createPeopleQueries } from "./query-factory";

export const getUsernameSettings = createUsernameQuery();
export const {
  searchPeople,
  getPersonProfile,
  getFriendsView,
  getMessageContacts,
  getMessageRequests,
} = createPeopleQueries();
