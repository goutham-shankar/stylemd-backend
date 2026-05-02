const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://gouthamsankarv_db_user:9LZmrc3puzYzFaQJ@cluster-prod.mupw4fp.mongodb.net/?appName=cluster-prod';

async function cleanupDatabase() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI, { dbName: 'stylemd' });
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;

    // 1. Drop the unique index on stylemd_runs collection
    console.log('\n1. Dropping unique index on stylemd_runs...');
    try {
      await db.collection('stylemd_runs').dropIndex('url_1');
      console.log('✓ Dropped url_1 index');
    } catch (err) {
      if (err.message.includes('index not found')) {
        console.log('✓ Index url_1 not found (already removed)');
      } else {
        console.warn('Warning:', err.message);
      }
    }

    // 2. Find and remove duplicate entries, keeping the most recent
    console.log('\n2. Finding duplicates...');
    const duplicates = await db.collection('stylemd_runs').aggregate([
      {
        $group: {
          _id: '$url',
          count: { $sum: 1 },
          docs: { $push: { _id: '$_id', createdAt: '$createdAt' } },
        },
      },
      {
        $match: { count: { $gt: 1 } },
      },
    ]).toArray();

    if (duplicates.length === 0) {
      console.log('✓ No duplicates found');
    } else {
      console.log(`Found ${duplicates.length} duplicate URL(s):`);
      
      for (const dup of duplicates) {
        console.log(`\n  URL: ${dup._id}`);
        console.log(`  Count: ${dup.count}`);
        
        // Sort by createdAt descending, keep the first one (most recent)
        const sorted = dup.docs.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        });

        const keepId = sorted[0]._id;
        const deleteIds = sorted.slice(1).map(d => d._id);

        console.log(`  Keeping document: ${keepId}`);
        console.log(`  Deleting ${deleteIds.length} duplicate(s): ${deleteIds.join(', ')}`);

        // Delete old duplicates
        const deleteResult = await db.collection('stylemd_runs').deleteMany({
          _id: { $in: deleteIds },
        });
        console.log(`  ✓ Deleted ${deleteResult.deletedCount} document(s)`);
      }
    }

    // 3. Recreate the unique index
    console.log('\n3. Recreating unique index on stylemd_runs...');
    await db.collection('stylemd_runs').createIndex({ url: 1 }, { unique: true });
    console.log('✓ Created unique index on url field');

    // 4. Show final collection stats
    console.log('\n4. Final collection stats:');
    const count = await db.collection('stylemd_runs').countDocuments();
    const indexInfo = await db.collection('stylemd_runs').listIndexes().toArray();
    console.log(`  Total documents: ${count}`);
    console.log(`  Indexes: ${indexInfo.length}`);
    indexInfo.forEach(idx => console.log(`    - ${idx.name}`));

    console.log('\n✓ Database cleanup completed successfully!');

  } catch (error) {
    console.error('ERROR:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  }
}

cleanupDatabase();
