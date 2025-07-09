#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
// Multi-source environment variable getter for secret injection
function getEnv(key, req) {
    // 1. Try request headers (for secret injection)
    if (req?.headers && req.headers[key.toLowerCase()]) {
        return req.headers[key.toLowerCase()];
    }
    // 2. Try request context/body for environment variables
    if (req?.body?.context?.environment && req.body.context.environment[key]) {
        return req.body.context.environment[key];
    }
    // 3. Fallback to process environment
    return process.env[key];
}
// Configuration schema
export const configSchema = z.object({
    debug: z.boolean().default(false).describe("Enable debug logging"),
    apiKey: z.string().describe("Google Maps API key. Get one from https://mapsplatform.google.com"),
});
// Extract Google Maps tools for standalone use
function createGoogleMapsTools(config, req) {
    const apiKey = config.apiKey || getEnv('GOOGLE_MAPS_API_KEY', req) || getEnv('apiKey', req);
    if (!apiKey) {
        throw new Error('GOOGLE_MAPS_API_KEY is required but not provided');
    }
    const toolConfig = { ...config, apiKey };
    return {
        createServer: () => {
            const server = new McpServer({
                name: "google-maps-mcp-server",
                version: "0.1.0",
            });
            const GOOGLE_MAPS_API_KEY = toolConfig.apiKey;
            // API handlers
            async function handleGeocode(address) {
                const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
                url.searchParams.append("address", address);
                url.searchParams.append("key", GOOGLE_MAPS_API_KEY);
                const response = await fetch(url.toString());
                const data = await response.json();
                if (data.status !== "OK") {
                    throw new Error(`Geocoding failed: ${data.error_message || data.status}`);
                }
                return {
                    location: data.results[0].geometry.location,
                    formatted_address: data.results[0].formatted_address,
                    place_id: data.results[0].place_id
                };
            }
            async function handleReverseGeocode(latitude, longitude) {
                const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
                url.searchParams.append("latlng", `${latitude},${longitude}`);
                url.searchParams.append("key", GOOGLE_MAPS_API_KEY);
                const response = await fetch(url.toString());
                const data = await response.json();
                if (data.status !== "OK") {
                    throw new Error(`Reverse geocoding failed: ${data.error_message || data.status}`);
                }
                return {
                    formatted_address: data.results[0].formatted_address,
                    place_id: data.results[0].place_id,
                    address_components: data.results[0].address_components
                };
            }
            async function handlePlaceSearch(query, location, radius) {
                const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
                url.searchParams.append("query", query);
                url.searchParams.append("key", GOOGLE_MAPS_API_KEY);
                if (location) {
                    url.searchParams.append("location", `${location.latitude},${location.longitude}`);
                }
                if (radius) {
                    url.searchParams.append("radius", radius.toString());
                }
                const response = await fetch(url.toString());
                const data = await response.json();
                if (data.status !== "OK") {
                    throw new Error(`Place search failed: ${data.error_message || data.status}`);
                }
                return {
                    places: data.results.map((place) => ({
                        name: place.name,
                        formatted_address: place.formatted_address,
                        location: place.geometry.location,
                        place_id: place.place_id,
                        rating: place.rating,
                        types: place.types
                    }))
                };
            }
            async function handlePlaceDetails(place_id) {
                const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
                url.searchParams.append("place_id", place_id);
                url.searchParams.append("key", GOOGLE_MAPS_API_KEY);
                const response = await fetch(url.toString());
                const data = await response.json();
                if (data.status !== "OK") {
                    throw new Error(`Place details request failed: ${data.error_message || data.status}`);
                }
                return {
                    name: data.result.name,
                    formatted_address: data.result.formatted_address,
                    location: data.result.geometry.location,
                    formatted_phone_number: data.result.formatted_phone_number,
                    website: data.result.website,
                    rating: data.result.rating,
                    reviews: data.result.reviews,
                    opening_hours: data.result.opening_hours
                };
            }
            async function handleDistanceMatrix(origins, destinations, mode = "driving") {
                const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
                url.searchParams.append("origins", origins.join("|"));
                url.searchParams.append("destinations", destinations.join("|"));
                url.searchParams.append("mode", mode);
                url.searchParams.append("key", GOOGLE_MAPS_API_KEY);
                const response = await fetch(url.toString());
                const data = await response.json();
                if (data.status !== "OK") {
                    throw new Error(`Distance matrix request failed: ${data.error_message || data.status}`);
                }
                return {
                    origin_addresses: data.origin_addresses,
                    destination_addresses: data.destination_addresses,
                    results: data.rows.map((row) => ({
                        elements: row.elements.map((element) => ({
                            status: element.status,
                            duration: element.duration,
                            distance: element.distance
                        }))
                    }))
                };
            }
            async function handleElevation(locations) {
                const url = new URL("https://maps.googleapis.com/maps/api/elevation/json");
                const locationString = locations
                    .map((loc) => `${loc.latitude},${loc.longitude}`)
                    .join("|");
                url.searchParams.append("locations", locationString);
                url.searchParams.append("key", GOOGLE_MAPS_API_KEY);
                const response = await fetch(url.toString());
                const data = await response.json();
                if (data.status !== "OK") {
                    throw new Error(`Elevation request failed: ${data.error_message || data.status}`);
                }
                return {
                    results: data.results.map((result) => ({
                        elevation: result.elevation,
                        location: result.location,
                        resolution: result.resolution
                    }))
                };
            }
            async function handleDirections(origin, destination, mode = "driving") {
                const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
                url.searchParams.append("origin", origin);
                url.searchParams.append("destination", destination);
                url.searchParams.append("mode", mode);
                url.searchParams.append("key", GOOGLE_MAPS_API_KEY);
                const response = await fetch(url.toString());
                const data = await response.json();
                if (data.status !== "OK") {
                    throw new Error(`Directions request failed: ${data.error_message || data.status}`);
                }
                return {
                    routes: data.routes.map((route) => ({
                        summary: route.summary,
                        distance: route.legs[0].distance,
                        duration: route.legs[0].duration,
                        steps: route.legs[0].steps.map((step) => ({
                            instructions: step.html_instructions,
                            distance: step.distance,
                            duration: step.duration,
                            travel_mode: step.travel_mode
                        }))
                    }))
                };
            }
            // Register tools
            server.tool("maps_geocode", "Convert an address into geographic coordinates", {
                address: z.string().describe("The address to geocode"),
            }, async ({ address }) => {
                const result = await handleGeocode(address);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            });
            server.tool("maps_reverse_geocode", "Convert coordinates into an address", {
                latitude: z.number().describe("Latitude coordinate"),
                longitude: z.number().describe("Longitude coordinate"),
            }, async ({ latitude, longitude }) => {
                const result = await handleReverseGeocode(latitude, longitude);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            });
            server.tool("maps_search_places", "Search for places using Google Places API", {
                query: z.string().describe("Search query"),
                location: z.object({
                    latitude: z.number(),
                    longitude: z.number(),
                }).optional().describe("Optional center point for the search"),
                radius: z.number().optional().describe("Search radius in meters (max 50000)"),
            }, async ({ query, location, radius }) => {
                const result = await handlePlaceSearch(query, location, radius);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            });
            server.tool("maps_place_details", "Get detailed information about a specific place", {
                place_id: z.string().describe("The place ID to get details for"),
            }, async ({ place_id }) => {
                const result = await handlePlaceDetails(place_id);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            });
            server.tool("maps_distance_matrix", "Calculate travel distance and time for multiple origins and destinations", {
                origins: z.array(z.string()).describe("Array of origin addresses or coordinates"),
                destinations: z.array(z.string()).describe("Array of destination addresses or coordinates"),
                mode: z.enum(["driving", "walking", "bicycling", "transit"]).optional().describe("Travel mode"),
            }, async ({ origins, destinations, mode }) => {
                const result = await handleDistanceMatrix(origins, destinations, mode);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            });
            server.tool("maps_elevation", "Get elevation data for locations on the earth", {
                locations: z.array(z.object({
                    latitude: z.number(),
                    longitude: z.number(),
                })).describe("Array of locations to get elevation for"),
            }, async ({ locations }) => {
                const result = await handleElevation(locations);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            });
            server.tool("maps_directions", "Get directions between two points", {
                origin: z.string().describe("Starting point address or coordinates"),
                destination: z.string().describe("Ending point address or coordinates"),
                mode: z.enum(["driving", "walking", "bicycling", "transit"]).optional().describe("Travel mode"),
            }, async ({ origin, destination, mode }) => {
                const result = await handleDirections(origin, destination, mode);
                return {
                    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                };
            });
            return server.server;
        }
    };
}
export default function createStatelessServer({ config, }) {
    const { createServer } = createGoogleMapsTools(config);
    return createServer();
}
// HTTP Bridge for remote deployment
async function startHttpServer() {
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json({ limit: '50mb' }));
    let mcpServer = null;
    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });
    // Health check for GET /mcp as well
    app.get('/mcp', (req, res) => {
        res.json({
            status: 'ready',
            name: 'Google Maps MCP Server',
            version: '0.1.0'
        });
    });
    // Main MCP endpoint
    app.post('/mcp', async (req, res) => {
        try {
            const { method, params } = req.body;
            if (method === 'initialize') {
                // Extract config from params, with API key injection support
                const apiKey = getEnv('GOOGLE_MAPS_API_KEY', req) || getEnv('apiKey', req);
                if (!apiKey) {
                    return res.status(400).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32602,
                            message: 'GOOGLE_MAPS_API_KEY is required'
                        },
                        id: req.body.id
                    });
                }
                const config = {
                    apiKey,
                    debug: params?.debug || false
                };
                try {
                    const { createServer } = createGoogleMapsTools(config, req);
                    mcpServer = createServer();
                    res.json({
                        jsonrpc: '2.0',
                        result: {
                            protocolVersion: '2024-11-05',
                            capabilities: {
                                tools: {}
                            },
                            serverInfo: {
                                name: 'Google Maps MCP Server',
                                version: '0.1.0'
                            }
                        },
                        id: req.body.id
                    });
                }
                catch (error) {
                    res.status(500).json({
                        jsonrpc: '2.0',
                        error: {
                            code: -32603,
                            message: `Failed to initialize server: ${error instanceof Error ? error.message : String(error)}`
                        },
                        id: req.body.id
                    });
                }
                return;
            }
            if (!mcpServer) {
                return res.status(400).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32002,
                        message: 'Server not initialized. Call initialize first.'
                    },
                    id: req.body.id
                });
            }
            if (method === 'tools/list') {
                const toolsList = await mcpServer.request({ method: 'tools/list' });
                res.json({
                    jsonrpc: '2.0',
                    result: toolsList,
                    id: req.body.id
                });
                return;
            }
            if (method === 'tools/call') {
                const result = await mcpServer.request({
                    method: 'tools/call',
                    params: params
                });
                res.json({
                    jsonrpc: '2.0',
                    result: result,
                    id: req.body.id
                });
                return;
            }
            // Handle other methods
            const result = await mcpServer.request({ method, params });
            res.json({
                jsonrpc: '2.0',
                result: result,
                id: req.body.id
            });
        }
        catch (error) {
            console.error('MCP request error:', error);
            res.status(500).json({
                jsonrpc: '2.0',
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : String(error)
                },
                id: req.body.id
            });
        }
    });
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Google Maps MCP Server listening on port ${PORT}`);
        console.log(`Health check: http://localhost:${PORT}/health`);
        console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
    });
}
// Start HTTP server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    startHttpServer().catch(console.error);
}
