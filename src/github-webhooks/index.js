exports.handler = async (event, context) => {
    console.log('RECEIVED EVENT', JSON.stringify(event));
    return true;
};