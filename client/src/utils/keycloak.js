import Keycloak from 'keycloak-js';

const keycloakConfig = {
  url: 'http://localhost:8080',
  realm: 'Parksphere',
  clientId: 'parksphere-client',
};

const keycloak = new Keycloak(keycloakConfig);

export default keycloak;
