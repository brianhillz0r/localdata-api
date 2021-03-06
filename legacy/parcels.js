/*jslint node: true */
'use strict';

/*
 * ==================================================
 * Parcels
 * ==================================================
 * 
 * Serves parcel data from the geo database.
 */

var pg = require('pg');
var lru = require('lru-cache');
var crypto = require('crypto');

var client = null;

function bboxToPolygon(bbox) {
  var polygon = 'POLYGON((' +
                bbox[0] + ' ' + bbox[1] + ', ' +
                bbox[0] + ' ' + bbox[3] + ', ' +
                bbox[2] + ' ' + bbox[3] + ', ' +
                bbox[2] + ' ' + bbox[1] + ', ' +
                bbox[0] + ' ' + bbox[1] + '))';
  return polygon;
}


/* 
 * Make values returned by the database neater.
 */ 
function clean(val) { 
  if(val !== null) {
    return val.trim();
  }
  return '';
}

function CustomParcelArrayBuilder() {
  this.output = [];
}

CustomParcelArrayBuilder.prototype.addParcel = function (id, address, polygon, centroid, type) {
  this.output.push({
    parcelId: id,
    address: address,
    polygon: polygon,
    centroid: centroid,
    type: type
  });
};

CustomParcelArrayBuilder.prototype.generate = function () {
  return this.output;
};

function GeoJSONBuilder() {
  this.features = [];
}

GeoJSONBuilder.prototype.addParcel = function (id, address, geometry, centroid, type) {
  this.features.push({
    type: 'Feature',
    id: id,
    geometry: geometry,
    properties: {
      address: address,
      centroid: centroid
    }
  });
};

GeoJSONBuilder.prototype.generate = function () {
  return {
    type: 'FeatureCollection',
    features: this.features
  };
};

/*
 * app: express server
 */
function setup(app, settings) {
  var connectionString =
    'tcp://' + settings.psqlUser + ':' + settings.psqlPass +
    '@' + settings.psqlHost + '/' + settings.psqlName;

  if (client === null) {
    client = new pg.Client(connectionString);
    client.connect();
  }

  var cache = lru({
    max: 500,
    maxAge: 1000 * 60 * 60 // 1 hour
  });

  function useCache(req, res, next) {
    var etag = req.headers['if-none-match'];

    if (etag !== undefined && cache.get(req.url) === etag) {
      res.set('ETag', etag);
      res.send(304);
      return;
    }

    var end = res.end;
    res.end = function (body) {
      var etag = this.get('ETag');
      if (etag === undefined) {
        var hash = crypto.createHash('md5');
        hash.update(body);
        etag = '"' + hash.digest('base64') + '"';
        res.set('ETag', etag);
      }
      cache.set(req.url, etag);
      end.call(res, body);
    };

    return next();
  }

  // Get parcels
  // Filter to include only parcels inside a bounding box or only parcels that
  // intersect a point.
  // Use outputBuilder to generate the appropriate type of output
  function getParcels(req, response, outputBuilder) {
    var bbox = req.query.bbox;
    var lon = req.query.lon;
    var lat = req.query.lat;
    var query;
    var coordString;
    var coords;
    var output;
    var error;
    var i;
    
    // Require a filter
    if (bbox === undefined &&
        (lon === undefined || lat === undefined)) {
      response.send(413);
      return;
    }

    if (bbox !== undefined) {
      // Bounding box query

      // Don't allow both filters at once
      if (lon !== undefined || lat !== undefined) {
        response.send(400);
        return;
      }

      // Split bounding box into coordinates
      coordString = bbox.split(',');

      if (coordString.length !== 4) {
        response.send(400);
        return;
      }

      // Convert coordinates to numbers
      coords = [];
      for (i = 0; i < 4; i += 1) {
        coords[i] = parseFloat(coordString[i]);

        // Make sure the conversion worked
        if (isNaN(coords[i])) {
          response.send(400);
          return;
        }
      }

      query = client.query({
        text: 'SELECT object_id, name1, name2, source, created, ST_AsGeoJSON(wkb_geometry) AS polygon, ST_AsGeoJSON(ST_Centroid(wkb_geometry)) AS centroid, GeometryType(wkb_geometry) as type FROM objects WHERE ST_Intersects(wkb_geometry, ST_SetSRID($1, 4326))',
        values: [bboxToPolygon(coords)],
        name: 'parcelBBoxQuery'
      });
    } else {
      // Point query

      // Convert coordinates to numbers
      lat = parseFloat(lat);
      lon = parseFloat(lon);

      if (isNaN(lat) || isNaN(lon)) {
        response.send(400);
        return;
      }

      query = client.query({
        text: 'SELECT object_id, name1, name2, source, created, ST_AsGeoJSON(wkb_geometry) AS polygon, ST_AsGeoJSON(ST_Centroid(wkb_geometry)) AS centroid, GeometryType(wkb_geometry) as type FROM objects WHERE ST_Contains(wkb_geometry, ST_SetSRID($1, 4326))',
        values: ['POINT(' + lon + ' ' + lat + ')'],
        name: 'parcelPointQuery'
      });
    }
    
    output = [];
    query
    .on('row', function (row, result) {
      try {
        outputBuilder.addParcel(clean(row.object_id),
                                clean(row.name1) + ' ' + clean(row.name2),
                                JSON.parse(row.polygon),
                                JSON.parse(row.centroid),
                                clean(row.type));
      } catch (e) {
        console.log(row);
        error = e;
      }
    })
    .on('error', function (e) {
      console.log(e.message);
      error = e;
    })
    .on('end', function (result) {
      if (error) {
        console.log(error);
        response.send(500);
      } else {
        response.send(outputBuilder.generate());
      }
    });
  }

  // Get parcels
  // Filter to include only parcels inside a bounding box or only parcels that
  // intersect a point.
  // We do not allow filtering by both, and we require one of the filters.
  // GET http://localhost:3000/api/parcels?bbox=-{SW_LON},{SW_LAT},{NE_LON},{NE_LAT}
  // GET http://localhost:3000/api/parcels?bbox=-83.0805,42.336,-83.08,42.34
  // GET http://localhost:3000/api/parcels?lon={LONGITUDE}&lat={LATITUDE}
  // GET http://localhost:3000/api/parcels?lon=-83.08076&lat=42.338
  app.get('/api/parcels', function(req, response) {
    return getParcels(req, response, new CustomParcelArrayBuilder());
  });

  // Get parcels as a GeoJSON FeatureCollection
  // Filter to include only parcels inside a bounding box or only parcels that
  // intersect a point.
  // We do not allow filtering by both, and we require one of the filters.
  // GET http://localhost:3000/api/parcels?bbox=-{SW_LON},{SW_LAT},{NE_LON},{NE_LAT}
  // GET http://localhost:3000/api/parcels?bbox=-83.0805,42.336,-83.08,42.34
  // GET http://localhost:3000/api/parcels?lon={LONGITUDE}&lat={LATITUDE}
  // GET http://localhost:3000/api/parcels?lon=-83.08076&lat=42.338
  app.get('/api/parcels.geojson', useCache, function(req, response, next) {
    return getParcels(req, response, new GeoJSONBuilder());
  });

}

module.exports = {
  setup: setup
};
