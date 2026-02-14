const { initAuthCreds } = require('@whiskeysockets/baileys');
const { BufferJSON } = require('@whiskeysockets/baileys');

/**
 * Custom MongoDB auth state implementation for Baileys
 * Stores authentication state in MongoDB instead of file system
 */
async function useMongoDBAuthState(collection) {
    const writeData = async (data, key) => {
        try {
            const serialized = JSON.stringify(data, BufferJSON.replacer);
            await collection.updateOne(
                { _id: key },
                { $set: { value: serialized } },
                { upsert: true }
            );
        } catch (error) {
            console.error(`Error writing data for key ${key}:`, error);
        }
    };

    const readData = async (key) => {
        try {
            const doc = await collection.findOne({ _id: key });
            if (doc && doc.value) {
                return JSON.parse(doc.value, BufferJSON.reviver);
            }
            return null;
        } catch (error) {
            console.error(`Error reading data for key ${key}:`, error);
            return null;
        }
    };

    const removeData = async (key) => {
        try {
            await collection.deleteOne({ _id: key });
        } catch (error) {
            console.error(`Error removing data for key ${key}:`, error);
        }
    };

    const creds = await readData('creds') || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                const { proto } = require('@whiskeysockets/baileys');
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            return writeData(creds, 'creds');
        }
    };
}

module.exports = { useMongoDBAuthState };
