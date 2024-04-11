

import { mixFetch } from '@nymproject/mix-fetch-full-fat';


const mixFetchOptions = {
  preferredGateway: 'CqxY8LzQR97EcLLaHzhhNBVkGxiA4WhPjERA2WN5nUsi', // replace with actual gateway
  preferredNetworkRequester: 'EckThLD2H3MXonPBHYVkNF936gcxjVzuFS5WbDPYn9ak.EbS2TyKXm6rAk4u7sAN4hXSZSYRaDfV4pvvPYjSGgBPB@CqxY8LzQR97EcLLaHzhhNBVkGxiA4WhPjERA2WN5nUsi'
  , // replace with actual network requester
  mixFetchOverride: {
    requestTimeoutMs: 60000,
  },
  forceTls: true, // if you need to force TLS
  extra: {},
};


// Import from "@inrupt/solid-client-authn-browser"
import {
  login,
  handleIncomingRedirect,
  getDefaultSession,
  fetch
} from "@inrupt/solid-client-authn-browser";

// Import from "@inrupt/solid-client"
import {
  addUrl,
  getThing,
  getUrl,
  addStringNoLocale,
  createSolidDataset,
  createThing,
  getPodUrlAll,
  getSolidDataset,
  getThingAll,
  getStringNoLocale,
  removeThing,
  saveSolidDatasetAt,
  setThing
} from "@inrupt/solid-client";

import { SCHEMA_INRUPT, RDF, AS } from "@inrupt/vocab-common-rdf";

const selectorIdP = document.querySelector("#select-idp");
const selectorPod = document.querySelector("#select-pod");
const buttonLogin = document.querySelector("#btnLogin");
const buttonRead = document.querySelector("#btnRead");
const buttonCreate = document.querySelector("#btnCreate");
const labelCreateStatus = document.querySelector("#labelCreateStatus");

buttonRead.setAttribute("disabled", "disabled");
buttonLogin.setAttribute("disabled", "disabled");
buttonCreate.setAttribute("disabled", "disabled");

// 1a. Start Login Process. Call login() function.
function loginToSelectedIdP() {
  const SELECTED_IDP = document.getElementById("select-idp").value;

  return login({
    oidcIssuer: SELECTED_IDP,
    redirectUrl: new URL("/", window.location.href).toString(),
    clientName: "Getting started app"
  });
}

// 1b. Login Redirect. Call handleIncomingRedirect() function.
// When redirected after login, finish the process by retrieving session information.
async function handleRedirectAfterLogin() {
  await handleIncomingRedirect(); // no-op if not part of login redirect

  const session = getDefaultSession();
  if (session.info.isLoggedIn) {
    // Update the page with the status.
    document.getElementById("myWebID").value = session.info.webId;

    // Enable Read button to read Pod URL
    buttonRead.removeAttribute("disabled");
  }
}

// The example has the login redirect back to the root page.
// The page calls this method, which, in turn, calls handleIncomingRedirect.
handleRedirectAfterLogin();

// 2. Get Pod(s) associated with the WebID
async function getMyPods() {
  
  const webID = document.getElementById("myWebID").value;
  const mypods = await getPodUrlAll(webID, { 
    fetch: (url) => mixFetch(url, mixFetchOptions)
  });

  mypods.forEach((mypod) => {
    let podOption = document.createElement("option");
    podOption.textContent = mypod;
    podOption.value = mypod;
    selectorPod.appendChild(podOption);
  });
}

// 3. Create the Preferences List
async function createPreferences() {
  labelCreateStatus.textContent = "";
  const SELECTED_POD = document.getElementById("select-pod").value;

  // For simplicity and brevity, this tutorial hardcodes the  SolidDataset URL.
  // In practice, you should add in your profile a link to this resource
  // such that applications can follow to find your list.
  const preferencesUrl = `${SELECTED_POD}preferences/myPreferences`;

  let preferences = document.getElementById("preferences").value.split("\n");

  // Fetch or create a new preference list.
  let myPreferencesList;

  try {
    // Attempt to retrieve the reading list in case it already exists.
    myPreferencesList = await getSolidDataset(preferencesUrl, { fetch: fetch });
    // Clear the list to override the whole list
    let items = getThingAll(myPreferencesList);
    items.forEach((item) => {
      myPreferencesList = removeThing(myPreferencesList, item);
    });
  } catch (error) {
    if (typeof error.statusCode === "number" && error.statusCode === 404) {
      // if not found, create a new SolidDataset (i.e., the preference list)
      myPreferencesList = createSolidDataset();
    } else {
      console.error(error.message);
    }
  }

  // Add preferences to the Dataset
  let i = 0;
  preferences.forEach((preference) => {
    if (preference.trim() !== "") {
      let item = createThing({ name: "preference" + i });
      item = addUrl(item, RDF.type, AS.Article);
      item = addStringNoLocale(item, SCHEMA_INRUPT.name, preference);
      myPreferencesList = setThing(myPreferencesList, item);
      i++;
    }
  });

  try {
    // Save the SolidDataset
    let savedPreferencesList = await saveSolidDatasetAt(
      preferencesUrl,
      myPreferencesList,
      { fetch: fetch }
    );

    labelCreateStatus.textContent = "Saved";

    // Refetch the Preferences List
    savedPreferencesList = await getSolidDataset(preferencesUrl, { fetch: fetch });

    let savedItems = getThingAll(savedPreferencesList);

    let listContent = "";
    for (let i = 0; i < savedItems.length; i++) {
      let item = getStringNoLocale(savedItems[i], SCHEMA_INRUPT.name);
      if (item !== null) {
        listContent += item + "\n";
      }
    }

    document.getElementById("savedPreferences").value = listContent;
  } catch (error) {
    console.log(error);
    labelCreateStatus.textContent = "Error" + error;
    labelCreateStatus.setAttribute("role", "alert");
  }
}

buttonLogin.onclick = function () {
  loginToSelectedIdP();
};

buttonRead.onclick = function () {
  getMyPods();
};

buttonCreate.onclick = function () {
  createPreferences();
};

selectorIdP.addEventListener("change", idpSelectionHandler);
function idpSelectionHandler() {
  if (selectorIdP.value === "") {
    buttonLogin.setAttribute("disabled", "disabled");
  } else {
    buttonLogin.removeAttribute("disabled");
  }
}

selectorPod.addEventListener("change", podSelectionHandler);
function podSelectionHandler() {
  if (selectorPod.value === "") {
    buttonCreate.setAttribute("disabled", "disabled");
    // Ensure the "Find Matches" button is also disabled if no Pod is selected
    document.getElementById('btnFindMatches').setAttribute("disabled", "disabled");
  } else {
    buttonCreate.removeAttribute("disabled");
    // Enable the "Find Matches" button once a Pod is selected
    document.getElementById('btnFindMatches').removeAttribute("disabled");
  }
}



// Helper function to fetch the base storage URL from a WebID profile document
async function fetchBaseStorageUrlFromProfile(profileDocumentUrl) {
  // Here you would fetch and parse the profile document to find the base storage URL.
  // Since you already know the structure, you can construct it by replacing the end of the URL.
  const baseStorageUrl = profileDocumentUrl.replace('/profile', ''); 
  return baseStorageUrl;
}




// Function to construct the preferences URL from the WebID
async function getPreferencesUrlFromWebId(webId) {
  try {
    // First, fetch the WebID profile document to get the profile document URL.
    const webIdDocument = await getSolidDataset(webId, { fetch: fetch });
    const profileThing = getThing(webIdDocument, webId);
    // Assuming the profile document URL is stored as a 'seeAlso' reference in the profile.
    const profileDocumentUrl = getUrl(profileThing, "http://www.w3.org/2000/01/rdf-schema#seeAlso");
    
    if (!profileDocumentUrl) {
      throw new Error('Profile document URL not found in WebID profile.');
    }
    
    // Now, fetch the base storage URL from the profile document URL.
    const baseStorageUrl = await fetchBaseStorageUrlFromProfile(profileDocumentUrl);
    
    // Construct the preferences URL using the base storage URL.
    const preferencesUrl = `${baseStorageUrl}/preferences/myPreferences`;
    return preferencesUrl;
  } catch (error) {
    // Handle the case where the profile document URL cannot be fetched.
    console.error('Error constructing preferences URL:', error);
    throw error;
  }
}

// Function to fetch preferences from a given URL
async function fetchPreferences(url) {
  try {
    const myDataset = await getSolidDataset(url, { fetch: fetch });
    console.log("Fetched dataset:", myDataset);

    const allThings = getThingAll(myDataset);
    allThings.forEach((thing, index) => {
      console.log(`Thing ${index}:`, thing);
      for (const propertyUrl of Object.keys(thing.predicates)) {
        const propertyValues = thing.predicates[propertyUrl].literals || thing.predicates[propertyUrl].namedNodes;
        console.log(` - Property ${propertyUrl}:`, propertyValues);
      }
    });

    const preferences = allThings.map(thing => getStringNoLocale(thing, 'http://schema.org/name'));
    console.log("Extracted preferences:", preferences);
    return preferences.filter(preference => preference != null);
  } catch (error) {
    console.error('Error fetching preferences:', error);
    return [];
  }
}
  
// Function to find matches between two sets of preferences
async function findMatches(currentUserPreferencesUrl, otherUserPreferencesUrl) {
  const currentUserPreferences = await fetchPreferences(currentUserPreferencesUrl);
  const otherUserPreferences = await fetchPreferences(otherUserPreferencesUrl);

  if (currentUserPreferences && otherUserPreferences) {
    const matches = currentUserPreferences.filter(preference =>
      otherUserPreferences.includes(preference)
    );

    if (matches.length > 0) {
      console.log('Matches found:', matches);
      document.getElementById("matchResults").value = "Matches: " + matches.join(", ");
    } else {
      console.log('No matches found.');
      document.getElementById("matchResults").value = "No matches found.";
    }
  }
}


// Updated function to handle the Find Matches click event
document.getElementById('btnFindMatches').addEventListener('click', async () => {
  const currentUserWebId = document.getElementById("myWebID").value;
  const otherUserWebId = document.getElementById("otherUserWebId").value;

  try {
    // Fetch the preferences URLs using the WebIDs
    const currentUserPreferencesUrl = await getPreferencesUrlFromWebId(currentUserWebId);
    const otherUserPreferencesUrl = await getPreferencesUrlFromWebId(otherUserWebId);

    // Call the findMatches function with the fetched URLs
    await findMatches(currentUserPreferencesUrl, otherUserPreferencesUrl);
  } catch (error) {
    console.error('Error in matching process:', error);
    // Update the UI to show an error message
    document.getElementById("matchResults").value = `Error: ${error.message}`;
  }
});

