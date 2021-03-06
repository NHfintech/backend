module.exports = (sequelize, DataTypes) => {
    return sequelize.define('eventadmin', {
        id: {
            type: DataTypes.INTEGER,
            allowNull: false,
            unique: true,
            autoIncrement: true,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        user_phone: {
            type: DataTypes.STRING(15),
            allowNull: false,
        },
        event_id: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        message: {
            type: DataTypes.STRING(100),
            allowNull: false,
            defaultValue: '',
        },
    },
    {
        timestamps: false,
    });
};
